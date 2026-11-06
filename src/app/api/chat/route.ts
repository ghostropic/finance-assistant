import { z } from "zod"
import { encodeSse } from "@/chat/sse"
import { localToday } from "@/lib/dates"
import { errorClassOf, log } from "@/lib/log"
import { getDb } from "@/lib/db"
import { anthropicEnv } from "@/lib/env"
import { runChatTurn, ConversationNotFoundError } from "@/server/chat"
import { getAnthropic, getSyncRunnerIfConfigured } from "@/server/clients"
import { rejectNonLocal } from "@/server/local-only"

const chatRequestInput = z
  .object({
    conversationId: z.uuid().optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict()

// One turn per conversation at a time. In-memory is enough for one local user.
const activeConversationIds = new Set<string>()

/** POST { conversationId?, message } -> text/event-stream of ChatEvents. */
export async function POST(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const parsed = chatRequestInput.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success)
    return Response.json(
      { error: "Expected { message, conversationId? }." },
      { status: 400 },
    )
  const { conversationId, message } = parsed.data
  if (conversationId && activeConversationIds.has(conversationId)) {
    return Response.json(
      { error: "This conversation is already answering a question." },
      { status: 409 },
    )
  }

  const { ANTHROPIC_MODEL: model, ANTHROPIC_EFFORT: effort } = anthropicEnv()
  const encoder = new TextEncoder()
  let lockedId: string | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) =>
        controller.enqueue(encoder.encode(encodeSse(type, data)))
      try {
        for await (const event of runChatTurn({
          db: getDb(),
          client: getAnthropic(),
          conversationId,
          message,
          model,
          effort,
          today: localToday(),
          sync: getSyncRunnerIfConfigured(),
          signal: request.signal,
        })) {
          if (event.type === "conversation") {
            lockedId = event.id
            activeConversationIds.add(event.id)
          }
          send(event.type, event)
        }
      } catch (err) {
        if (!request.signal.aborted) {
          // The loop's chat_turn line covers Claude API failures; this records the request's outcome.
          const isNotFound = err instanceof ConversationNotFoundError
          const errorClass = errorClassOf(err)
          log({
            event: "http_error",
            route: "/api/chat",
            status: isNotFound ? 404 : 500,
            errorKind: isNotFound ? "conversation_not_found" : "internal",
            ...(errorClass && !isNotFound ? { errorClass } : {}),
          })
          const message =
            err instanceof ConversationNotFoundError
              ? "That conversation doesn't exist."
              : err instanceof Error
                ? err.message
                : "Something went wrong."
          send("error", { type: "error", message })
        }
      } finally {
        if (lockedId) activeConversationIds.delete(lockedId)
        try {
          controller.close()
        } catch {
          // Already closed because the browser disconnected.
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
