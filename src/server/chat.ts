import { runAgent, type Usage } from "@/agent/loop"
import type Anthropic from "@anthropic-ai/sdk"
import type { ChatEvent } from "@/chat/display"
import type { PrismaClient } from "@/generated/prisma/client"
import type { Prisma } from "@/generated/prisma/client"
import type { SyncRunner } from "@/sync/runner"

// One chat turn for the web app: load the conversation, run the loop, save
// the result (docs/milestone-2.md). History lives on the server and is
// append-only, so Claude's thinking blocks are always replayed unchanged.

const TITLE_LENGTH = 60

export interface ChatTurnOptions {
  db: PrismaClient
  client: Anthropic
  /** Omit to start a new conversation. */
  conversationId?: string
  message: string
  model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  today: string
  /** Lets Claude sync through sync_now. Omit where Plaid isn't configured. */
  sync?: SyncRunner
  signal?: AbortSignal
}

export class ConversationNotFoundError extends Error {}

export function formatConversationTitle(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim()
  return oneLine.length > TITLE_LENGTH
    ? `${oneLine.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
    : oneLine
}

export async function loadHistory(
  db: PrismaClient,
  conversationId: string,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await db.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { seq: "asc" },
  })
  return rows.map((r) => ({
    role: r.role as Anthropic.Beta.BetaMessageParam["role"],
    content: r.content as unknown as Anthropic.Beta.BetaMessageParam["content"],
  }))
}

/** Saved token usage for a conversation, keyed by the `seq` of each turn's question. */
export async function loadUsageBySeq(
  db: PrismaClient,
  conversationId: string,
): Promise<Map<number, Usage>> {
  const rows = await db.turnMetrics.findMany({ where: { conversationId } })
  return new Map(
    rows.map((r) => [
      r.seq,
      {
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        cache_read_input_tokens: r.cacheReadTokens,
        cache_creation_input_tokens: r.cacheWriteTokens,
      },
    ]),
  )
}

export async function* runChatTurn(
  opts: ChatTurnOptions,
): AsyncGenerator<ChatEvent> {
  const { db } = opts
  const started = Date.now()

  const conversation = opts.conversationId
    ? await db.conversation.findUnique({ where: { id: opts.conversationId } })
    : await db.conversation.create({
        data: { title: formatConversationTitle(opts.message) },
      })
  if (!conversation)
    throw new ConversationNotFoundError(
      `No conversation ${opts.conversationId}`,
    )
  yield {
    type: "conversation",
    id: conversation.id,
    title: conversation.title,
  }

  let done: Extract<ChatEvent, { type: "done" }> | undefined
  const history = await loadHistory(db, conversation.id)
  const savedCount = history.length
  history.push({ role: "user", content: opts.message })

  for await (const event of runAgent({
    client: opts.client,
    ctx: { db, today: opts.today, sync: opts.sync },
    history,
    model: opts.model,
    effort: opts.effort,
    signal: opts.signal,
    conversationId: conversation.id,
  })) {
    if (event.type === "done") done = event
    yield event
  }

  // Save only a turn that ended on Claude's reply. A turn cut short (round
  // limit, refusal, cut-off tool call) would leave history ending mid-exchange.
  if (history.at(-1)?.role !== "assistant") return

  const newMessages = history.slice(savedCount)
  await db.$transaction([
    db.conversationMessage.createMany({
      data: newMessages.map((m, i) => ({
        conversationId: conversation.id,
        seq: savedCount + i,
        role: m.role,
        content: m.content as unknown as Prisma.InputJsonValue,
      })),
    }),
    db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    }),
    ...(done
      ? [
          db.turnMetrics.create({
            data: {
              conversationId: conversation.id,
              seq: savedCount,
              model: opts.model,
              effort: opts.effort,
              rounds: done.rounds,
              inputTokens: done.usage.input_tokens,
              outputTokens: done.usage.output_tokens,
              cacheReadTokens: done.usage.cache_read_input_tokens,
              cacheWriteTokens: done.usage.cache_creation_input_tokens,
              durationMs: Date.now() - started,
            },
          }),
        ]
      : []),
  ])
}

/** Conversations that have at least one saved turn, newest first. */
export function loadConversationSummaries(db: PrismaClient) {
  return db.conversation.findMany({
    where: { messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
    take: 100,
  })
}

/** Deletes a conversation with its messages and usage. False if there's no such conversation. */
export async function deleteConversation(
  db: PrismaClient,
  conversationId: string,
): Promise<boolean> {
  const { count } = await db.conversation.deleteMany({
    where: { id: conversationId },
  })
  return count > 0
}
