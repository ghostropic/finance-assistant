import { TransactionsUpdateStatus } from "plaid"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { runAgent } from "@/agent/loop"
import { captureLogs } from "@/lib/log"
import { toErrorResponse } from "@/server/errors"
import { createSyncRunner } from "@/sync/runner"
import { startTestDb, type TestDb } from "./helpers/db"
import { collect, fakeClient, text, toolUse } from "./helpers/fake-anthropic"
import { seed, TODAY } from "./helpers/fixtures"
import type Anthropic from "@anthropic-ai/sdk"
import type { SyncClient } from "@/sync/sync"

// The logging rule from docs/security.md, checked end to end: run a realistic
// chat turn, a sync and a Plaid error, then make sure nothing from the data,
// the question or the answer reached the log.

const QUESTION =
  "How much did I spend at Chipotle and Whole Foods in September?"
const ANSWER =
  "You spent $20.00 at Chipotle and $80.00 at Whole Foods, $1,778.98 in total."
const SYNCED_MERCHANT = "Secret Bakery On Elm Street"

/** Strings that must never appear in a log line. */
const SENSITIVE = [
  QUESTION,
  ANSWER,
  SYNCED_MERCHANT,
  "Chipotle",
  "Whole Foods",
  "Netflix",
  "Everyday Checking",
  "Rewards Card",
  "Fixture Bank",
  "1778.98",
  "1,778.98",
  "15.49",
  "2500",
  "access-token-value",
  "PLAID-SECRET",
]

let testDb: TestDb
let capture: ReturnType<typeof captureLogs> | undefined

beforeAll(async () => {
  testDb = await startTestDb()
  await seed(testDb.db)
})
afterAll(() => testDb?.stop())
afterEach(() => capture?.stop())

const expectNothingSensitive = (entries: Record<string, unknown>[]) => {
  const logged = JSON.stringify(entries)
  for (const value of SENSITIVE)
    expect(logged, `log contains "${value}"`).not.toContain(value)
  expect(entries.filter((e) => e.event === "log_rejected")).toEqual([])
}

describe("logs contain no financial data", () => {
  it("for a chat turn with tool calls, including a failed one", async () => {
    capture = captureLogs()
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("tu_1", "search_transactions", {
            merchant: "Chipotle",
            start_date: "2026-09-01",
            end_date: "2026-09-30",
          }),
          toolUse("tu_2", "spending_by_category", {
            start_date: "2026-09-01",
            end_date: "2026-09-30",
          }),
          toolUse("tu_3", "get_balances", {}),
          toolUse("tu_4", "search_transactions", {
            merchant: "Whole Foods",
            limit: 9999,
          }),
        ],
      },
      { stop_reason: "end_turn", content: [text(ANSWER)] },
    ])
    const history: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: QUESTION },
    ]

    await collect(
      runAgent({
        client,
        ctx: { db: testDb.db, today: TODAY },
        history,
        model: "claude-opus-5-5",
        effort: "medium",
        conversationId: "6f1c7c1e-2b6a-4d8e-9a43-1b2f3c4d5e6f",
      }),
    )

    expect(capture.entries.map((e) => e.event)).toEqual([
      "tool_call",
      "tool_call",
      "tool_call",
      "tool_call",
      "chat_turn",
    ])
    expect(capture.entries.at(-1)).toMatchObject({
      outcome: "answered",
      rounds: 2,
      toolCalls: 4,
      inputTokens: 200,
    })
    expect(
      capture.entries.filter((e) => e.event === "tool_call" && e.ok === false),
    ).toMatchObject([{ errorKind: "invalid_input" }])
    expectNothingSensitive(capture.entries)
  })

  it("for a sync, including a bank that fails", async () => {
    const bank = await testDb.db.plaidItem.create({
      data: {
        plaidItemId: "item-log",
        environment: "sandbox",
        institutionName: "Fixture Bank 2",
        accessTokenEncrypted: "access-token-value",
      },
    })
    const plaid = {
      accountsGet: async () => ({
        data: { accounts: [], item: {}, request_id: "req" },
      }),
      transactionsSync: async ({ access_token }: { access_token: string }) => {
        if (access_token !== "access-token-value")
          return Promise.reject({
            response: {
              data: {
                error_code: "ITEM_LOGIN_REQUIRED",
                error_message: "Chipotle",
              },
            },
          })
        return {
          data: {
            added: [
              {
                transaction_id: "log-t1",
                account_id: "log-acc",
                amount: 1778.98,
                date: "2026-09-29",
                name: SYNCED_MERCHANT,
                pending: false,
              },
            ],
            modified: [],
            removed: [],
            accounts: [
              {
                account_id: "log-acc",
                name: "Everyday Checking",
                mask: "9999",
                type: "depository",
                balances: { current: 2500 },
              },
            ],
            has_more: false,
            next_cursor: "c1",
            transactions_update_status:
              TransactionsUpdateStatus.HistoricalUpdateComplete,
          },
        }
      },
    } as unknown as SyncClient

    capture = captureLogs()
    const runner = createSyncRunner({
      db: testDb.db,
      plaid,
      openToken: (sealed) => sealed,
      environment: "sandbox",
    })
    await runner.sync({ trigger: "button" })

    expect(capture.entries).toMatchObject([
      {
        event: "sync_run",
        trigger: "button",
        status: "synced",
        banks: 2,
        synced: 1,
        needsReconnect: 1,
        added: 1,
        errorCodes: ["ITEM_LOGIN_REQUIRED"],
      },
    ])
    expectNothingSensitive(capture.entries)
    await testDb.db.plaidItem.delete({ where: { id: bank.id } })
  })

  it("for a Plaid error whose details include data and secrets", () => {
    capture = captureLogs()
    const plaidError = {
      message: "Request failed for Chipotle $1778.98",
      config: {
        headers: { "PLAID-SECRET": "PLAID-SECRET", "PLAID-CLIENT-ID": "id" },
        data: '{"access_token":"access-token-value"}',
      },
      response: {
        data: {
          error_code: "INVALID_PUBLIC_TOKEN",
          error_message: "Whole Foods",
          display_message: "Netflix",
        },
      },
    }
    toErrorResponse(plaidError, "/api/plaid/exchange")
    toErrorResponse(
      new Error("Fixture Bank 2500 Everyday Checking"),
      "/api/sync",
    )

    expect(capture.entries).toMatchObject([
      {
        event: "http_error",
        route: "/api/plaid/exchange",
        status: 502,
        errorKind: "plaid_error",
        plaidCode: "INVALID_PUBLIC_TOKEN",
      },
      {
        event: "http_error",
        route: "/api/sync",
        status: 500,
        errorKind: "internal",
        errorClass: "Error",
      },
    ])
    expectNothingSensitive(capture.entries)
  })
})
