import { summarizeToolResult } from "@/tools/summary"
import type Anthropic from "@anthropic-ai/sdk"
import type { AgentEvent, Usage } from "@/agent/loop"

// What the chat page shows, built two ways that must agree:
//   applyEvent:         live, from streamed events
//   mapMessagesToTurns: on reload, from the stored Anthropic messages
// Type-only imports from the loop, so this is safe in the browser.

/** Every event /api/chat streams. The SSE event name is `type`. */
export type ChatEvent =
  | AgentEvent
  | { type: "conversation"; id: string; title: string }
  | { type: "error"; message: string }

export type Part =
  | { type: "text"; text: string }
  | {
      type: "tool"
      id: string
      name: string
      input: unknown
      status: "running" | "ok" | "error"
      summary?: string
    }
  | { type: "notice"; text: string }

export interface Turn {
  id: string
  question: string
  parts: Part[]
  status: "streaming" | "done" | "error" | "stopped"
  usage?: Usage
  error?: string
}

export function applyEvent(turn: Turn, event: ChatEvent): Turn {
  switch (event.type) {
    case "text": {
      const last = turn.parts.at(-1)
      if (last?.type === "text") {
        return {
          ...turn,
          parts: [
            ...turn.parts.slice(0, -1),
            { type: "text", text: last.text + event.text },
          ],
        }
      }
      return {
        ...turn,
        parts: [...turn.parts, { type: "text", text: event.text }],
      }
    }
    case "tool_start":
      return {
        ...turn,
        parts: [
          ...turn.parts,
          {
            type: "tool",
            id: event.id,
            name: event.name,
            input: event.input,
            status: "running",
          },
        ],
      }
    case "tool_result":
      return {
        ...turn,
        parts: turn.parts.map((p) =>
          p.type === "tool" && p.id === event.id
            ? {
                ...p,
                status: event.ok ? "ok" : "error",
                summary: event.summary,
              }
            : p,
        ),
      }
    case "notice":
      return {
        ...turn,
        parts: [...turn.parts, { type: "notice", text: event.message }],
      }
    case "done":
      return { ...turn, status: "done", usage: event.usage }
    case "error":
      return { ...turn, status: "error", error: event.message }
    case "conversation":
      return turn
  }
}

function extractText(
  content: Anthropic.Beta.BetaMessageParam["content"],
): string {
  if (typeof content === "string") return content
  return content.map((b) => (b.type === "text" ? b.text : "")).join("")
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b ? String(b.text) : "",
      )
      .join("")
  return ""
}

/** Rebuilds the page's turns from stored messages, with saved usage keyed by each question's position. */
export function mapMessagesToTurns(
  messages: Anthropic.Beta.BetaMessageParam[],
  idPrefix = "turn",
  usageBySeq: ReadonlyMap<number, Usage> = new Map(),
): Turn[] {
  const turns: Turn[] = []
  for (const [seq, message] of messages.entries()) {
    const current = turns.at(-1)
    if (message.role === "user") {
      const blocks = typeof message.content === "string" ? [] : message.content
      const results = blocks.filter((b) => b.type === "tool_result")
      if (results.length && current) {
        for (const r of results) {
          const isError = Boolean(r.is_error)
          const text = extractToolResultText(r.content)
          let summary = text
          if (!isError) {
            try {
              summary = summarizeToolResult(JSON.parse(text))
            } catch {
              summary = "done"
            }
          }
          current.parts = current.parts.map((p) =>
            p.type === "tool" && p.id === r.tool_use_id
              ? { ...p, status: isError ? "error" : "ok", summary }
              : p,
          )
        }
      } else {
        const usage = usageBySeq.get(seq)
        turns.push({
          id: `${idPrefix}-${turns.length}`,
          question: extractText(message.content),
          parts: [],
          status: "done",
          ...(usage ? { usage } : {}),
        })
      }
    } else if (current && typeof message.content !== "string") {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          const last = current.parts.at(-1)
          if (last?.type === "text") last.text += block.text
          else current.parts.push({ type: "text", text: block.text })
        } else if (block.type === "tool_use") {
          current.parts.push({
            type: "tool",
            id: block.id,
            name: block.name,
            input: block.input,
            status: "running",
          })
        }
      }
    } else if (current && typeof message.content === "string") {
      current.parts.push({ type: "text", text: message.content })
    }
  }
  return turns
}
