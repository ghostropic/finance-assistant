import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runAgent } from "@/agent/loop"
import { startTestDb, type TestDb } from "./helpers/db"
import { seed, TODAY } from "./helpers/fixtures"
import { collect, fakeClient, text, toolUse } from "./helpers/fake-anthropic"
import type Anthropic from "@anthropic-ai/sdk"

// The loop against a scripted fake of the streaming API (tests/helpers/fake-anthropic.ts).
// Checks the message bookkeeping, which is where tool loops usually break.

let testDb: TestDb
beforeAll(async () => {
  testDb = await startTestDb()
  await seed(testDb.db)
})
afterAll(() => testDb?.stop())

describe("runAgent", () => {
  it("runs parallel tool calls, returns all results in one message, then streams the answer", async () => {
    const { client, requests } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          text("Checking. "),
          toolUse("tu_1", "spending_by_category", {
            start_date: "2026-09-01",
            end_date: "2026-09-30",
          }),
          toolUse("tu_2", "spending_by_category", {
            start_date: "2026-09-30",
            end_date: "2026-09-01",
          }),
        ],
      },
      {
        stop_reason: "end_turn",
        content: [text("You spent $1,778.98 in September.")],
      },
    ])
    const history: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: "How much did I spend in September?" },
    ]

    const events = await collect(
      runAgent({
        client,
        ctx: { db: testDb.db, today: TODAY },
        history,
        model: "claude-opus-5-5",
        effort: "medium",
      }),
    )

    expect(events.map((e) => e.type)).toEqual([
      "text",
      "tool_start",
      "tool_start",
      "tool_result",
      "tool_result",
      "text",
      "done",
    ])
    expect(
      events.find((e) => e.type === "tool_result" && e.id === "tu_1"),
    ).toMatchObject({ ok: true, summary: "4 categories, $1778.98 spent" })
    expect(
      events.find((e) => e.type === "tool_result" && e.id === "tu_2"),
    ).toMatchObject({ ok: false })
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "end_turn",
      rounds: 2,
      usage: {
        input_tokens: 200,
        output_tokens: 40,
        cache_read_input_tokens: 100,
      },
    })

    // user, assistant (tool calls), user (both results), assistant (answer)
    expect(history.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    const results = history[2]
      .content as Anthropic.Beta.BetaToolResultBlockParam[]
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ["tu_1", false],
      ["tu_2", true],
    ])
    expect(JSON.parse(results[0].content as string).total_spent).toBe(1778.98)

    // The second request carried the tool results; fallbacks were requested.
    expect(requests[1].messages).toHaveLength(3)
    expect(requests[0]).toMatchObject({
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    })
  })

  it("stops after the round limit", async () => {
    const loopForever = Array.from({ length: 3 }, (_, i) => ({
      stop_reason: "tool_use",
      content: [toolUse(`tu_${i}`, "get_balances", {})],
    }))
    const { client } = fakeClient(loopForever)
    const events = await collect(
      runAgent({
        client,
        ctx: { db: testDb.db, today: TODAY },
        history: [{ role: "user", content: "hi" }],
        model: "m",
        effort: "low",
        maxRounds: 2,
      }),
    )
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "max_rounds",
      rounds: 2,
    })
  })

  it("doesn't run tools from a response cut off at max_tokens", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "max_tokens",
        content: [toolUse("tu_1", "get_balances", {})],
      },
    ])
    const events = await collect(
      runAgent({
        client,
        ctx: { db: testDb.db, today: TODAY },
        history: [{ role: "user", content: "hi" }],
        model: "m",
        effort: "low",
      }),
    )
    expect(events.some((e) => e.type === "tool_start")).toBe(false)
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "max_tokens",
    })
  })
})
