import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  applyEvent,
  mapMessagesToTurns,
  type ChatEvent,
  type Turn,
} from "@/chat/display"
import {
  runChatTurn,
  ConversationNotFoundError,
  deleteConversation,
  loadConversationSummaries,
  loadHistory,
  loadUsageBySeq,
  formatConversationTitle,
} from "@/server/chat"
import { startTestDb, type TestDb } from "./helpers/db"
import {
  collect,
  fakeClient,
  text,
  thinking,
  toolUse,
  type Scripted,
} from "./helpers/fake-anthropic"
import { seed, TODAY } from "./helpers/fixtures"
import type Anthropic from "@anthropic-ai/sdk"

let testDb: TestDb
beforeAll(async () => {
  testDb = await startTestDb()
  await seed(testDb.db)
})
afterAll(() => testDb?.stop())
beforeEach(async () => {
  await testDb.db.conversation.deleteMany()
})

const SEPT = { start_date: "2026-09-01", end_date: "2026-09-30" }

const turnWithTool = (): Scripted[] => [
  {
    stop_reason: "tool_use",
    content: [
      thinking("sig-1"),
      text("Checking. "),
      toolUse("tu_1", "spending_by_category", SEPT),
    ],
  },
  { stop_reason: "end_turn", content: [text("You spent **$1,778.98**.")] },
]

function run(
  scripted: Scripted[],
  message: string,
  conversationId?: string,
  signal?: AbortSignal,
) {
  const { client, requests } = fakeClient(scripted)
  const events = collect(
    runChatTurn({
      db: testDb.db,
      client,
      conversationId,
      message,
      model: "m",
      effort: "low",
      today: TODAY,
      signal,
    }),
  )
  return { events, requests }
}

describe("runChatTurn", () => {
  it("creates a conversation, streams its id first, and saves the whole turn", async () => {
    const { events } = run(turnWithTool(), "How much did I spend in September?")
    const all = await events

    expect(all[0]).toMatchObject({
      type: "conversation",
      title: "How much did I spend in September?",
    })
    expect(all.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn" })

    const id = (all[0] as { id: string }).id
    const history = await loadHistory(testDb.db, id)
    expect(history.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    // Thinking blocks are stored exactly, so they can be replayed.
    expect(
      (history[1].content as { type: string; signature?: string }[])[0],
    ).toMatchObject({ type: "thinking", signature: "sig-1" })
    expect(await loadConversationSummaries(testDb.db)).toHaveLength(1)
  })

  it("sends the saved history with a follow-up and appends to it", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id

    const { events, requests } = run(
      [{ stop_reason: "end_turn", content: [text("August was $1,774.48.")] }],
      "And August?",
      id,
    )
    await events

    expect(requests[0].messages).toHaveLength(5) // 4 saved + the new question
    expect(requests[0].messages[4]).toEqual({
      role: "user",
      content: "And August?",
    })
    expect((await loadHistory(testDb.db, id)).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    const seqs = (
      await testDb.db.conversationMessage.findMany({
        where: { conversationId: id },
        orderBy: { seq: "asc" },
      })
    ).map((m) => m.seq)
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("saves nothing when the turn fails partway", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id

    const { events } = run(
      [
        {
          stop_reason: "tool_use",
          content: [toolUse("tu_9", "get_balances", {})],
        },
        { error: new Error("API down") },
      ],
      "Balances?",
      id,
    )
    await expect(events).rejects.toThrow("API down")
    expect(await loadHistory(testDb.db, id)).toHaveLength(4)
  })

  it("saves nothing when the turn ends without Claude's reply (refusal)", async () => {
    const { events } = run(
      [{ stop_reason: "refusal", content: [] }],
      "Something declined",
    )
    const all = await events
    const id = (all[0] as { id: string }).id
    expect(await loadHistory(testDb.db, id)).toHaveLength(0)
    expect(await loadConversationSummaries(testDb.db)).toHaveLength(0) // empty conversations aren't listed
  })

  it("rejects an unknown conversation", async () => {
    const { events } = run([], "hi", "00000000-0000-4000-8000-000000000000")
    await expect(events).rejects.toBeInstanceOf(ConversationNotFoundError)
  })
})

describe("display", () => {
  it("rebuilds the same turns on reload as were shown while streaming", async () => {
    const all = (await run(turnWithTool(), "How much did I spend in September?")
      .events) as ChatEvent[]
    const id = (all[0] as { id: string }).id

    let live: Turn = {
      id: "live",
      question: "How much did I spend in September?",
      parts: [],
      status: "streaming",
    }
    for (const e of all) live = applyEvent(live, e)

    const [reloaded] = mapMessagesToTurns(await loadHistory(testDb.db, id))
    expect(reloaded.question).toBe(live.question)
    expect(reloaded.parts).toEqual(live.parts)
    expect(live.parts).toEqual([
      { type: "text", text: "Checking. " },
      {
        type: "tool",
        id: "tu_1",
        name: "spending_by_category",
        input: SEPT,
        status: "ok",
        summary: "4 categories, $1778.98 spent",
      },
      { type: "text", text: "You spent **$1,778.98**." },
    ])
  })

  it("shows failed tool calls as errors on reload", () => {
    const history: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: "Q" },
      {
        role: "assistant",
        content: [
          toolUse("tu_1", "search_transactions", { limit: 500 }),
        ] as never,
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: "Invalid input. limit: too big",
            is_error: true,
          },
        ],
      },
      { role: "assistant", content: [text("Sorry.")] as never },
    ]
    expect(mapMessagesToTurns(history)[0].parts[0]).toMatchObject({
      type: "tool",
      status: "error",
      summary: "Invalid input. limit: too big",
    })
  })

  it("keeps titles to one line of 60 characters", () => {
    expect(formatConversationTitle("  What did\nI spend  ")).toBe(
      "What did I spend",
    )
    const long = formatConversationTitle("x".repeat(100))
    expect(long).toHaveLength(60)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("turn metrics", () => {
  it("saves usage for a completed turn, keyed by its question's position", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id
    await run(
      [{ stop_reason: "end_turn", content: [text("August was $1,774.48.")] }],
      "And August?",
      id,
    ).events

    const rows = await testDb.db.turnMetrics.findMany({
      where: { conversationId: id },
      orderBy: { seq: "asc" },
    })
    expect(rows).toMatchObject([
      {
        seq: 0,
        model: "m",
        effort: "low",
        rounds: 2,
        inputTokens: 200,
        outputTokens: 40,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
      },
      { seq: 4, rounds: 1, inputTokens: 100, outputTokens: 20 },
    ])
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it("saves nothing for a turn that wasn't saved", async () => {
    await run([{ error: new Error("API down") }], "September?").events.catch(
      () => undefined,
    )
    expect(await testDb.db.turnMetrics.count()).toBe(0)
  })

  it("shows saved usage under each answer after a reload", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id
    const turns = mapMessagesToTurns(
      await loadHistory(testDb.db, id),
      id,
      await loadUsageBySeq(testDb.db, id),
    )
    expect(turns[0].usage).toEqual({
      input_tokens: 200,
      output_tokens: 40,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 0,
    })
  })
})

describe("deleteConversation", () => {
  it("deletes the conversation with its messages and usage, leaving others", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id
    const other = await run(turnWithTool(), "Again?").events
    const otherId = (other[0] as { id: string }).id

    expect(await deleteConversation(testDb.db, id)).toBe(true)

    expect(await loadHistory(testDb.db, id)).toHaveLength(0)
    expect(
      await testDb.db.turnMetrics.count({ where: { conversationId: id } }),
    ).toBe(0)
    expect(
      (await loadConversationSummaries(testDb.db)).map((c) => c.id),
    ).toEqual([otherId])
  })

  it("returns false for an unknown conversation", async () => {
    expect(
      await deleteConversation(
        testDb.db,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toBe(false)
  })

  it("refuses a follow-up in a deleted conversation", async () => {
    const first = await run(turnWithTool(), "September?").events
    const id = (first[0] as { id: string }).id
    await deleteConversation(testDb.db, id)

    const { events } = run([], "And August?", id)
    await expect(events).rejects.toBeInstanceOf(ConversationNotFoundError)
  })
})
