import { afterEach, describe, expect, it } from "vitest"
import { captureLogs, log, type LogEvent } from "@/lib/log"

let capture: ReturnType<typeof captureLogs> | undefined
afterEach(() => capture?.stop())

const toolCall: LogEvent = {
  event: "tool_call",
  tool: "spending_by_category",
  ok: true,
  durationMs: 12,
}

describe("log", () => {
  it("writes one JSON object per event, with a timestamp", () => {
    capture = captureLogs()
    log(toolCall)
    expect(capture.entries).toEqual([
      { time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), ...toolCall },
    ])
  })

  it("drops an event with free text where a code belongs, and records only its name", () => {
    capture = captureLogs()
    log({
      event: "http_error",
      route: "/api/plaid/exchange",
      status: 502,
      errorKind: "plaid_error",
      plaidCode: "Coffee at Corner Bakery $42.50",
    })
    expect(capture.entries).toEqual([
      {
        time: expect.any(String),
        event: "log_rejected",
        rejectedEvent: "http_error",
      },
    ])
    expect(JSON.stringify(capture.entries)).not.toMatch(/Corner Bakery|42\.50/)
  })

  it("drops an event with a field its schema doesn't have", () => {
    capture = captureLogs()
    log({ ...toolCall, merchant: "Chipotle" } as unknown as LogEvent)
    expect(capture.entries.map((e) => e.event)).toEqual(["log_rejected"])
    expect(JSON.stringify(capture.entries)).not.toContain("Chipotle")
  })

  it("drops an unknown event without echoing its name", () => {
    capture = captureLogs()
    log({ event: "Chipotle $20" } as unknown as LogEvent)
    expect(capture.entries).toEqual([
      {
        time: expect.any(String),
        event: "log_rejected",
        rejectedEvent: "unknown",
      },
    ])
  })

  it("accepts the fields each event allows", () => {
    capture = captureLogs()
    const events: LogEvent[] = [
      {
        event: "chat_turn",
        conversationId: "6f1c7c1e-2b6a-4d8e-9a43-1b2f3c4d5e6f",
        model: "claude-opus-5-5",
        effort: "medium",
        outcome: "answered",
        stopReason: "end_turn",
        rounds: 2,
        toolCalls: 3,
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
        durationMs: 4200,
      },
      {
        event: "tool_call",
        tool: "search_transactions",
        ok: false,
        errorKind: "failed",
        errorClass: "PrismaClientKnownRequestError",
        durationMs: 3,
      },
      {
        event: "sync_run",
        trigger: "button",
        status: "synced",
        banks: 2,
        synced: 1,
        needsReconnect: 1,
        failed: 0,
        waitingForPlaid: 0,
        added: 4,
        modified: 1,
        removed: 0,
        skipped: 0,
        errorCodes: ["ITEM_LOGIN_REQUIRED"],
        durationMs: 1800,
      },
      {
        event: "http_error",
        route: "/api/plaid/exchange",
        status: 409,
        errorKind: "duplicate_bank",
      },
      { event: "startup_check", result: "ok" },
    ]
    for (const event of events) log(event)
    expect(capture.entries.map((e) => e.event)).toEqual([
      "chat_turn",
      "tool_call",
      "sync_run",
      "http_error",
      "startup_check",
    ])
  })

  it("never throws, even if a sink does", () => {
    capture = captureLogs(() => {
      throw new Error("disk full")
    })
    expect(() => log(toolCall)).not.toThrow()
  })
})
