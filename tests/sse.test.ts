import { describe, expect, it } from "vitest"
import { createSseParser, encodeSse, type SseMessage } from "@/chat/sse"

function parseAll(chunks: string[]) {
  const out: SseMessage[] = []
  const parser = createSseParser((m) => out.push(m))
  for (const c of chunks) parser.push(c)
  parser.end()
  return out
}

const events = [
  { type: "text", text: "Rent was $1,500.\n\n| a | b |\n|---|---|" },
  { type: "tool_start", id: "tu_1", name: "get_balances", input: {} },
  { type: "text", text: "emoji 💸 and unicode ✓" },
  { type: "done", stopReason: "end_turn" },
]
const wire = events.map((e) => encodeSse(e.type, e)).join("")

describe("SSE", () => {
  it("round-trips events in one chunk", () => {
    const parsed = parseAll([wire])
    expect(parsed.map((m) => m.event)).toEqual([
      "text",
      "tool_start",
      "text",
      "done",
    ])
    expect(parsed.map((m) => JSON.parse(m.data))).toEqual(events)
  })

  it("round-trips when the stream is split at every possible point", () => {
    for (let i = 1; i < wire.length; i++) {
      const parsed = parseAll([wire.slice(0, i), wire.slice(i)])
      expect(parsed.map((m) => JSON.parse(m.data))).toEqual(events)
    }
  })

  it("round-trips one character at a time", () => {
    expect(parseAll([...wire]).map((m) => JSON.parse(m.data))).toEqual(events)
  })

  it("handles CRLF line endings, including a CRLF split across chunks", () => {
    const crlf = wire.replace(/\n/g, "\r\n")
    for (let i = 1; i < crlf.length; i++) {
      expect(
        parseAll([crlf.slice(0, i), crlf.slice(i)]).map((m) =>
          JSON.parse(m.data),
        ),
      ).toEqual(events)
    }
  })

  it("ignores comments and keep-alives", () => {
    expect(parseAll([": ping\n\n", encodeSse("done", { ok: true })])).toEqual([
      { event: "done", data: '{"ok":true}' },
    ])
  })

  it("joins multi-line data with newlines", () => {
    expect(parseAll(["event: x\ndata: a\ndata: b\n\n"])).toEqual([
      { event: "x", data: "a\nb" },
    ])
  })
})
