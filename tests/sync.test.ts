import { TransactionsUpdateStatus } from "plaid"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  syncAll,
  syncItem,
  syncItemRecordingErrors,
  syncNewItem,
  type SyncClient,
} from "@/sync/sync"
import { startTestDb, type TestDb } from "./helpers/db"
import type {
  AccountBase,
  Transaction,
  TransactionsSyncRequest,
  TransactionsSyncResponse,
} from "plaid"

// A scripted stand-in for Plaid: each call returns the next page for the cursor it was given.

type Page = Partial<TransactionsSyncResponse> | { error: string }

/** `accounts` is what /accounts/get returns: every account, with its latest balance. */
function fakePlaid(
  pagesByCursor: Record<string, Page[]>,
  { accounts = [account] }: { accounts?: AccountBase[] } = {},
) {
  const calls: (string | undefined)[] = []
  const client: SyncClient = {
    accountsGet: (async () => ({
      data: { accounts, item: {}, request_id: "req" },
    })) as unknown as SyncClient["accountsGet"],
    transactionsSync: (async (req: TransactionsSyncRequest) => {
      calls.push(req.cursor)
      const queue = pagesByCursor[req.cursor ?? ""]
      const page = queue?.shift()
      if (!page) throw new Error(`no scripted page for cursor ${req.cursor}`)
      if ("error" in page)
        throw { response: { data: { error_code: page.error } } }
      return {
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [account],
          has_more: false,
          next_cursor: "",
          request_id: "req",
          transactions_update_status:
            TransactionsUpdateStatus.HistoricalUpdateComplete,
          ...page,
        },
      }
    }) as unknown as SyncClient["transactionsSync"],
  }
  return { client, calls }
}

const account = {
  account_id: "plaid-acc-1",
  name: "Plaid Checking",
  official_name: "Plaid Gold Standard Checking",
  type: "depository",
  subtype: "checking",
  mask: "0000",
  balances: {
    current: 110.5,
    available: 100,
    limit: null,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
  },
} as unknown as AccountBase

const savings = {
  ...account,
  account_id: "plaid-acc-2",
  name: "Plaid Saving",
  subtype: "savings",
  mask: "1111",
  balances: {
    current: 500,
    available: 500,
    limit: null,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
  },
} as unknown as AccountBase

const tx = (id: string, amount: number, extra: Partial<Transaction> = {}) =>
  ({
    transaction_id: id,
    account_id: "plaid-acc-1",
    amount,
    date: "2026-09-10",
    authorized_date: null,
    name: `Purchase ${id}`,
    merchant_name: "Shop",
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    pending: false,
    payment_channel: "in store",
    personal_finance_category: {
      primary: "GENERAL_MERCHANDISE",
      detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      confidence_level: "HIGH",
    },
    ...extra,
  }) as unknown as Transaction

let testDb: TestDb
let item: {
  id: string
  institutionName: string | null
  syncCursor: string | null
}

beforeAll(async () => {
  testDb = await startTestDb()
})
afterAll(() => testDb?.stop())

beforeEach(async () => {
  await testDb.db.plaidItem.deleteMany()
  item = await testDb.db.plaidItem.create({
    data: {
      plaidItemId: "item-1",
      environment: "sandbox",
      institutionName: "Test Bank",
      accessTokenEncrypted: "sealed",
    },
  })
})

const reload = () =>
  testDb.db.plaidItem.findUniqueOrThrow({ where: { id: item.id } })
const amounts = async () =>
  Object.fromEntries(
    (await testDb.db.transaction.findMany()).map((t) => [
      t.plaidTransactionId,
      Number(t.amount),
    ]),
  )

describe("syncItem", () => {
  it("stores accounts, balances and transactions, then saves the cursor", async () => {
    const { client } = fakePlaid({
      "": [{ added: [tx("t1", 12.34), tx("t2", -50)], next_cursor: "c1" }],
    })
    const result = await syncItem(testDb.db, client, item, "token")

    expect(result).toMatchObject({ added: 2, accounts: 1, outcome: "synced" })
    expect(await amounts()).toEqual({ t1: 12.34, t2: -50 })
    const acc = await testDb.db.account.findUniqueOrThrow({
      where: { plaidAccountId: "plaid-acc-1" },
    })
    expect([
      Number(acc.currentBalance),
      Number(acc.availableBalance),
      acc.mask,
    ]).toEqual([110.5, 100, "0000"])
    const saved = await reload()
    expect(saved.syncCursor).toBe("c1")
    expect(saved.lastSyncedAt).toBeInstanceOf(Date)
  })

  it("applies modified and removed transactions on the next sync", async () => {
    const { client } = fakePlaid({
      "": [
        {
          added: [tx("pending-1", 20, { pending: true }), tx("t2", 5)],
          next_cursor: "c1",
        },
      ],
      c1: [
        {
          added: [tx("posted-1", 21)],
          modified: [tx("t2", 6)],
          removed: [{ transaction_id: "pending-1", account_id: "plaid-acc-1" }],
          next_cursor: "c2",
        },
      ],
    })
    await syncItem(testDb.db, client, item, "token")
    await syncItem(testDb.db, client, await reload(), "token")

    expect(await amounts()).toEqual({ "posted-1": 21, t2: 6 })
    expect((await reload()).syncCursor).toBe("c2")
  })

  it("follows has_more across pages", async () => {
    const { client, calls } = fakePlaid({
      "": [{ added: [tx("t1", 1)], has_more: true, next_cursor: "p2" }],
      p2: [{ added: [tx("t2", 2)], next_cursor: "c-final" }],
    })
    await syncItem(testDb.db, client, item, "token")
    expect(calls).toEqual([undefined, "p2"])
    expect(Object.keys(await amounts()).sort()).toEqual(["t1", "t2"])
    expect((await reload()).syncCursor).toBe("c-final")
  })

  it("restarts from the first cursor when Plaid's data changes mid-pagination", async () => {
    const { client, calls } = fakePlaid({
      "": [
        { added: [tx("t1", 1)], has_more: true, next_cursor: "p2" },
        { added: [tx("t1", 1)], has_more: true, next_cursor: "p2b" },
      ],
      p2: [{ error: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" }],
      p2b: [{ added: [tx("t2", 2)], next_cursor: "c-final" }],
    })
    await syncItem(testDb.db, client, item, "token")
    expect(calls).toEqual([undefined, "p2", undefined, "p2b"])
    expect(await amounts()).toEqual({ t1: 1, t2: 2 })
    expect((await reload()).syncCursor).toBe("c-final")
  })

  it("saves nothing when Plaid isn't ready yet", async () => {
    const { client } = fakePlaid({
      "": [
        {
          next_cursor: "c-early",
          transactions_update_status: TransactionsUpdateStatus.NotReady,
        },
      ],
    })
    const result = await syncItem(testDb.db, client, item, "token")
    expect(result.outcome).toBe("waiting_for_plaid")
    expect((await reload()).syncCursor).toBeNull()
    expect(await testDb.db.account.count()).toBe(0)
  })

  it("changes nothing when run again with no updates", async () => {
    const { client } = fakePlaid({
      "": [{ added: [tx("t1", 1)], next_cursor: "c1" }],
      c1: [{ next_cursor: "c1" }],
    })
    await syncItem(testDb.db, client, item, "token")
    const before = await amounts()
    const second = await syncItem(testDb.db, client, await reload(), "token")
    expect(second).toMatchObject({ added: 0, modified: 0, removed: 0 })
    expect(await amounts()).toEqual(before)
  })

  it("leaves the old cursor if Plaid fails", async () => {
    const { client } = fakePlaid({ "": [{ error: "ITEM_LOGIN_REQUIRED" }] })
    await expect(
      syncItem(testDb.db, client, item, "token"),
    ).rejects.toBeTruthy()
    expect((await reload()).syncCursor).toBeNull()
  })
})

describe("syncItemRecordingErrors", () => {
  it("marks a bank that needs signing in again, and returns the outcome instead of throwing", async () => {
    const { client } = fakePlaid({ "": [{ error: "ITEM_LOGIN_REQUIRED" }] })
    const result = await syncItemRecordingErrors(
      testDb.db,
      client,
      item,
      "token",
    )
    expect(result).toMatchObject({
      outcome: "needs_reconnect",
      errorCode: "ITEM_LOGIN_REQUIRED",
      added: 0,
    })
    expect(await reload()).toMatchObject({
      status: "needs_reconnect",
      lastErrorCode: "ITEM_LOGIN_REQUIRED",
      syncCursor: null,
    })
  })

  it("records other Plaid errors without asking to reconnect", async () => {
    const { client } = fakePlaid({ "": [{ error: "INSTITUTION_DOWN" }] })
    expect(
      await syncItemRecordingErrors(testDb.db, client, item, "token"),
    ).toMatchObject({ outcome: "failed", errorCode: "INSTITUTION_DOWN" })
    expect(await reload()).toMatchObject({
      status: "ok",
      lastErrorCode: "INSTITUTION_DOWN",
    })
  })

  it("clears the error after a successful sync", async () => {
    const { client } = fakePlaid({
      "": [
        { error: "ITEM_LOGIN_REQUIRED" },
        { added: [tx("t1", 1)], next_cursor: "c1" },
      ],
    })
    await syncItemRecordingErrors(testDb.db, client, item, "token")
    expect(
      await syncItemRecordingErrors(testDb.db, client, await reload(), "token"),
    ).toMatchObject({ outcome: "synced" })
    expect(await reload()).toMatchObject({ status: "ok", lastErrorCode: null })
  })

  it("still throws errors that don't come from Plaid", async () => {
    const client = {
      transactionsSync: async () => Promise.reject(new Error("network down")),
    } as unknown as SyncClient
    await expect(
      syncItemRecordingErrors(testDb.db, client, item, "token"),
    ).rejects.toThrow("network down")
  })
})

describe("syncAll", () => {
  it("carries on past a broken bank", async () => {
    await testDb.db.plaidItem.create({
      data: {
        plaidItemId: "item-2",
        environment: "sandbox",
        institutionName: "Second Bank",
        accessTokenEncrypted: "sealed-2",
      },
    })
    const { client: healthy } = fakePlaid({
      "": [{ added: [tx("t1", 1)], next_cursor: "c1" }],
    })
    const client = {
      accountsGet: healthy.accountsGet,
      transactionsSync: (req: TransactionsSyncRequest) =>
        req.access_token === "token-for-sealed"
          ? Promise.reject({
              response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
            })
          : healthy.transactionsSync(req),
    } as unknown as SyncClient

    const results = await syncAll(
      testDb.db,
      client,
      (sealed) => `token-for-${sealed}`,
    )
    expect(results.map((r) => [r.institution, r.outcome])).toEqual([
      ["Test Bank", "needs_reconnect"],
      ["Second Bank", "synced"],
    ])
    expect(Object.keys(await amounts())).toEqual(["t1"])
  })
})

describe("syncNewItem", () => {
  it("retries while Plaid prepares a new bank's transactions", async () => {
    const notReady = {
      transactions_update_status: TransactionsUpdateStatus.NotReady,
      next_cursor: "c-early",
    }
    const { client, calls } = fakePlaid({
      "": [notReady, notReady, { added: [tx("t1", 1)], next_cursor: "c1" }],
    })
    const result = await syncNewItem(testDb.db, client, item, "token", {
      attempts: 5,
      retryMs: 0,
    })
    expect(result.outcome).toBe("synced")
    expect(calls).toHaveLength(3)
  })

  it("gives up after the last attempt and reports that Plaid is still preparing", async () => {
    const notReady = {
      transactions_update_status: TransactionsUpdateStatus.NotReady,
      next_cursor: "c-early",
    }
    const { client } = fakePlaid({ "": [notReady, notReady] })
    expect(
      (
        await syncNewItem(testDb.db, client, item, "token", {
          attempts: 2,
          retryMs: 0,
        })
      ).outcome,
    ).toBe("waiting_for_plaid")
  })
})

describe("syncItem with real-world Plaid responses", () => {
  // Plaid lists only the accounts with transactions in each page, not every account (docs/milestone-5.md).
  it("keeps transactions for accounts listed only on an earlier page", async () => {
    const { client } = fakePlaid(
      {
        "": [
          {
            added: [tx("t1", 1)],
            accounts: [account],
            has_more: true,
            next_cursor: "p2",
          },
        ],
        p2: [
          {
            added: [tx("t2", 2, { account_id: "plaid-acc-2" })],
            accounts: [savings],
            next_cursor: "c1",
          },
        ],
      },
      { accounts: [account, savings] },
    )
    const result = await syncItem(testDb.db, client, item, "token")
    expect(result).toMatchObject({ added: 2, skipped: 0, accounts: 2 })
    expect(await amounts()).toEqual({ t1: 1, t2: 2 })
  })

  it("refreshes balances, and adds accounts, that have no new transactions", async () => {
    const { client } = fakePlaid(
      {
        "": [{ added: [tx("t1", 1)], next_cursor: "c1" }],
        c1: [{ accounts: [], next_cursor: "c2" }],
      },
      { accounts: [account, savings] },
    )
    await syncItem(testDb.db, client, item, "token")
    const updated = {
      ...account,
      balances: { ...account.balances, current: 999 },
    } as AccountBase
    const { client: later } = fakePlaid(
      { c1: [{ accounts: [], next_cursor: "c2" }] },
      { accounts: [updated, savings] },
    )
    await syncItem(testDb.db, later, await reload(), "token")

    const rows = await testDb.db.account.findMany({
      orderBy: { plaidAccountId: "asc" },
    })
    expect(
      rows.map((a) => [a.plaidAccountId, Number(a.currentBalance)]),
    ).toEqual([
      ["plaid-acc-1", 999],
      ["plaid-acc-2", 500],
    ])
  })

  it("falls back to accounts saved by an earlier sync", async () => {
    const { client } = fakePlaid({
      "": [{ added: [tx("t1", 1)], next_cursor: "c1" }],
    })
    await syncItem(testDb.db, client, item, "token")
    const { client: later } = fakePlaid(
      { c1: [{ added: [tx("t2", 2)], accounts: [], next_cursor: "c2" }] },
      { accounts: [] },
    )
    expect(
      await syncItem(testDb.db, later, await reload(), "token"),
    ).toMatchObject({ added: 1, skipped: 0 })
    expect(await amounts()).toEqual({ t1: 1, t2: 2 })
  })

  it("counts only the transactions it saved, and reports the rest as skipped", async () => {
    const { client } = fakePlaid(
      {
        "": [
          {
            added: [tx("t1", 1), tx("t2", 2, { account_id: "unknown-acc" })],
            next_cursor: "c1",
          },
        ],
      },
      { accounts: [account] },
    )
    expect(await syncItem(testDb.db, client, item, "token")).toMatchObject({
      added: 1,
      skipped: 1,
    })
  })

  it("a full resync from an empty cursor restores missing transactions and drops ones Plaid no longer has", async () => {
    const { client } = fakePlaid({
      "": [
        {
          added: [tx("pending-1", 20, { pending: true }), tx("t2", 5)],
          next_cursor: "c1",
        },
      ],
    })
    await syncItem(testDb.db, client, item, "token")
    await testDb.db.plaidItem.update({
      where: { id: item.id },
      data: { syncCursor: null },
    })

    const { client: full } = fakePlaid({
      "": [
        {
          added: [tx("posted-1", 20), tx("t2", 5), tx("t3", 7)],
          next_cursor: "c9",
        },
      ],
    })
    await syncItem(testDb.db, full, await reload(), "token")
    expect(await amounts()).toEqual({ "posted-1": 20, t2: 5, t3: 7 })
  })

  it("deletes nothing on a full resync until Plaid has sent the whole history", async () => {
    const { client } = fakePlaid({
      "": [{ added: [tx("old-1", 20), tx("t2", 5)], next_cursor: "c1" }],
    })
    await syncItem(testDb.db, client, item, "token")
    await testDb.db.plaidItem.update({
      where: { id: item.id },
      data: { syncCursor: null },
    })

    const recentOnly = {
      added: [tx("t2", 5)],
      next_cursor: "c9",
      transactions_update_status:
        TransactionsUpdateStatus.InitialUpdateComplete,
    }
    const { client: partial } = fakePlaid({ "": [recentOnly] })
    await syncItem(testDb.db, partial, await reload(), "token")
    expect(await amounts()).toEqual({ "old-1": 20, t2: 5 })
  })
})
