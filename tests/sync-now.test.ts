import { TransactionsUpdateStatus } from "plaid"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { runTool } from "@/tools"
import { createSyncRunner } from "@/sync/runner"
import { startTestDb, type TestDb } from "./helpers/db"
import type { SyncClient } from "@/sync/sync"
import type { ToolContext } from "@/tools"
import type { TransactionsSyncRequest } from "plaid"

const TODAY = "2026-10-15"

let testDb: TestDb

beforeAll(async () => {
  testDb = await startTestDb()
})
afterAll(() => testDb?.stop())

beforeEach(async () => {
  await testDb.db.plaidItem.deleteMany()
  await testDb.db.plaidItem.create({
    data: {
      plaidItemId: "item-1",
      environment: "sandbox",
      institutionName: "Good Bank",
      accessTokenEncrypted: "good",
    },
  })
  await testDb.db.plaidItem.create({
    data: {
      plaidItemId: "item-2",
      environment: "sandbox",
      institutionName: "Locked Bank",
      accessTokenEncrypted: "locked",
    },
  })
})

/** Good Bank returns one purchase; Locked Bank needs the user to sign in again. */
function fakePlaid() {
  const state = { calls: 0 }
  const client = {
    accountsGet: async () => ({
      data: { accounts: [], item: {}, request_id: "req" },
    }),
    transactionsSync: async (req: TransactionsSyncRequest) => {
      state.calls++
      if (req.access_token === "locked")
        return Promise.reject({
          response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
        })
      return {
        data: {
          added: [
            {
              transaction_id: "t1",
              account_id: "acc-1",
              amount: 42.5,
              date: TODAY,
              name: "Corner Bakery",
              pending: false,
            },
          ],
          modified: [],
          removed: [],
          accounts: [
            {
              account_id: "acc-1",
              name: "Checking",
              mask: "1234",
              type: "depository",
              balances: { current: 100 },
            },
          ],
          has_more: false,
          next_cursor: `c${state.calls}`,
          transactions_update_status:
            TransactionsUpdateStatus.HistoricalUpdateComplete,
        },
      }
    },
  } as unknown as SyncClient
  return { client, state }
}

const contextWith = (
  plaid: SyncClient,
  environment: "sandbox" | "production" = "sandbox",
): ToolContext => ({
  db: testDb.db,
  today: TODAY,
  sync: createSyncRunner({
    db: testDb.db,
    plaid,
    openToken: (sealed) => sealed,
    environment,
  }),
})

describe("sync_now", () => {
  it("syncs and reports counts per bank, never the transactions themselves", async () => {
    const outcome = await runTool(
      contextWith(fakePlaid().client),
      "sync_now",
      {},
    )
    expect(outcome.ok).toBe(true)
    const result = (outcome as { result: Record<string, unknown> }).result
    expect(result).toMatchObject({
      status: "synced",
      new_transactions: 1,
      banks: [
        {
          bank: "Good Bank",
          status: "synced",
          added: 1,
          updated: 0,
          removed: 0,
        },
        { bank: "Locked Bank", status: "needs_reconnect" },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(
      /Corner Bakery|42\.5|item-1|acc-1/,
    )
    expect(await testDb.db.transaction.count()).toBe(1)
  })

  it("tells Claude how the user fixes a bank that needs reconnecting", async () => {
    const outcome = await runTool(
      contextWith(fakePlaid().client),
      "sync_now",
      {},
    )
    expect(JSON.stringify(outcome)).toMatch(/Reconnect/)
  })

  it("skips Plaid when the data was synced in the last 5 minutes", async () => {
    const plaid = fakePlaid()
    const ctx = contextWith(plaid.client)
    await runTool(ctx, "sync_now", {})
    const callsAfterFirst = plaid.state.calls
    const second = await runTool(ctx, "sync_now", {})
    expect(second).toMatchObject({
      ok: true,
      result: { status: "up_to_date", new_transactions: 0 },
    })
    expect(plaid.state.calls).toBe(callsAfterFirst)
  })

  it("says when syncing isn't available", async () => {
    const outcome = await runTool(
      { db: testDb.db, today: TODAY },
      "sync_now",
      {},
    )
    expect(outcome).toMatchObject({
      ok: true,
      result: { status: "unavailable" },
    })
  })

  it("refuses when PLAID_ENV doesn't match the database, without calling Plaid", async () => {
    const plaid = fakePlaid()
    const outcome = await runTool(
      contextWith(plaid.client, "production"),
      "sync_now",
      {},
    )
    expect(outcome).toMatchObject({ ok: true, result: { status: "refused" } })
    expect(plaid.state.calls).toBe(0)
  })

  it("rejects unexpected input", async () => {
    expect(
      (
        await runTool(contextWith(fakePlaid().client), "sync_now", {
          bank: "x",
        })
      ).ok,
    ).toBe(false)
  })
})
