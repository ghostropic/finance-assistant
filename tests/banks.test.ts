import { Products, TransactionsUpdateStatus } from "plaid"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EnvironmentMismatchError } from "@/lib/environment"
import {
  connectBank,
  createLinkToken,
  DuplicateBankError,
  listBanks,
  removeBank,
  type BanksDeps,
  type BanksPlaidClient,
} from "@/server/banks"
import { createSyncRunner } from "@/sync/runner"
import { startTestDb, type TestDb } from "./helpers/db"
import type { LinkTokenCreateRequest, Transaction } from "plaid"

let testDb: TestDb

beforeAll(async () => {
  testDb = await startTestDb()
})
afterAll(() => testDb?.stop())
beforeEach(() => testDb.db.plaidItem.deleteMany())

const plaidError = (code: string) =>
  Promise.reject({ response: { data: { error_code: code } } })

/** A Plaid stand-in: each public token becomes access token `access-<n>` at institution `ins_1`. */
function fakePlaid({ removeError }: { removeError?: string } = {}) {
  const linkRequests: LinkTokenCreateRequest[] = []
  const removed: string[] = []
  const calls = { exchanges: 0 }
  let exchanges = 0
  const client = {
    linkTokenCreate: async (req: LinkTokenCreateRequest) => {
      linkRequests.push(req)
      return { data: { link_token: "link-token" } }
    },
    itemPublicTokenExchange: async () => {
      exchanges++
      calls.exchanges = exchanges
      return {
        data: {
          access_token: `access-${exchanges}`,
          item_id: `plaid-item-${exchanges}`,
        },
      }
    },
    itemGet: async () => ({
      data: {
        item: { institution_id: "ins_1", institution_name: "Test Bank" },
      },
    }),
    itemRemove: async ({ access_token }: { access_token: string }) => {
      if (removeError) return plaidError(removeError)
      removed.push(access_token)
      return { data: {} }
    },
    accountsGet: async () => ({
      data: { accounts: [], item: {}, request_id: "req" },
    }),
    transactionsSync: async () => ({
      data: {
        added: [
          {
            transaction_id: "t1",
            account_id: "acc-1",
            amount: 5,
            date: "2026-10-01",
            name: "Coffee",
            pending: false,
          } as Transaction,
        ],
        modified: [],
        removed: [],
        accounts: [
          {
            account_id: "acc-1",
            name: "Checking",
            mask: "1234",
            type: "depository",
            subtype: "checking",
            balances: { current: 100 },
          },
        ],
        has_more: false,
        next_cursor: "c1",
        transactions_update_status:
          TransactionsUpdateStatus.HistoricalUpdateComplete,
      },
    }),
  } as unknown as BanksPlaidClient
  return { client, linkRequests, removed, calls }
}

const makeDeps = (
  plaid: BanksPlaidClient,
  environment: "sandbox" | "production" = "sandbox",
): BanksDeps => {
  const openToken = (sealed: string) => sealed.replace("sealed:", "")
  return {
    db: testDb.db,
    plaid,
    environment,
    sealToken: (token) => `sealed:${token}`,
    openToken,
    runner: createSyncRunner({ db: testDb.db, plaid, openToken, environment }),
  }
}

describe("createLinkToken", () => {
  it("asks only for the read-only transactions product, with two years of history", async () => {
    const plaid = fakePlaid()
    await createLinkToken(makeDeps(plaid.client))
    const [req] = plaid.linkRequests
    expect(req.products).toEqual([Products.Transactions])
    expect(req.transactions?.days_requested).toBe(730)
    expect(req.access_token).toBeUndefined()
    expect(
      req.additional_consented_products ??
        req.optional_products ??
        req.required_if_supported_products,
    ).toBeUndefined()
  })

  it("opens update mode for an existing bank with its access token and no products", async () => {
    const plaid = fakePlaid()
    const deps = makeDeps(plaid.client)
    const { bankId } = await connectBank(deps, "public-token")
    await createLinkToken(deps, bankId)
    const req = plaid.linkRequests.at(-1)!
    expect(req.access_token).toBe("access-1")
    expect(req.products).toBeUndefined()
  })
})

describe("connectBank", () => {
  it("stores the encrypted token, the environment and the institution, then syncs", async () => {
    const plaid = fakePlaid()
    const { firstSync } = await connectBank(
      makeDeps(plaid.client),
      "public-token",
    )
    expect(firstSync).toMatchObject({ outcome: "synced", added: 1 })
    const item = await testDb.db.plaidItem.findFirstOrThrow()
    expect(item).toMatchObject({
      accessTokenEncrypted: "sealed:access-1",
      environment: "sandbox",
      institutionId: "ins_1",
      institutionName: "Test Bank (Sandbox)",
      status: "ok",
    })
    expect(await testDb.db.transaction.count()).toBe(1)
  })

  it("refuses a bank that's already connected, and removes the new duplicate at Plaid", async () => {
    const plaid = fakePlaid()
    const deps = makeDeps(plaid.client)
    await connectBank(deps, "public-token")
    await expect(connectBank(deps, "public-token-2")).rejects.toBeInstanceOf(
      DuplicateBankError,
    )
    expect(plaid.removed).toEqual(["access-2"])
    expect(await testDb.db.plaidItem.count()).toBe(1)
  })

  it("refuses a bank that Link reports as already connected, without exchanging its token", async () => {
    const plaid = fakePlaid()
    const deps = makeDeps(plaid.client)
    await connectBank(deps, "public-token", "ins_1")
    await expect(
      connectBank(deps, "public-token-2", "ins_1"),
    ).rejects.toBeInstanceOf(DuplicateBankError)
    expect(plaid.calls.exchanges).toBe(1)
    expect(plaid.removed).toEqual([])
    expect(await testDb.db.plaidItem.count()).toBe(1)
  })

  it("treats Link's institution as a hint: a different value still gets the check after the exchange", async () => {
    const plaid = fakePlaid()
    const deps = makeDeps(plaid.client)
    await connectBank(deps, "public-token")
    await expect(
      connectBank(deps, "public-token-2", "ins_other"),
    ).rejects.toBeInstanceOf(DuplicateBankError)
    expect(plaid.removed).toEqual(["access-2"])
  })

  it("refuses to connect when PLAID_ENV doesn't match the database, before calling Plaid", async () => {
    await testDb.db.plaidItem.create({
      data: {
        plaidItemId: "old",
        environment: "sandbox",
        accessTokenEncrypted: "sealed:x",
      },
    })
    const plaid = fakePlaid()
    await expect(
      connectBank(makeDeps(plaid.client, "production"), "public-token"),
    ).rejects.toBeInstanceOf(EnvironmentMismatchError)
    expect(await testDb.db.plaidItem.count()).toBe(1)
  })
})

describe("removeBank", () => {
  it("removes the Item at Plaid, then deletes the bank and its data", async () => {
    const plaid = fakePlaid()
    const deps = makeDeps(plaid.client)
    const { bankId } = await connectBank(deps, "public-token")
    expect(await removeBank(deps, bankId)).toBe(true)
    expect(plaid.removed).toEqual(["access-1"])
    expect([
      await testDb.db.plaidItem.count(),
      await testDb.db.account.count(),
      await testDb.db.transaction.count(),
    ]).toEqual([0, 0, 0])
  })

  it("still deletes locally when Plaid no longer has the Item", async () => {
    const deps = makeDeps(fakePlaid().client)
    const { bankId } = await connectBank(deps, "public-token")
    expect(
      await removeBank(
        { ...deps, plaid: fakePlaid({ removeError: "ITEM_NOT_FOUND" }).client },
        bankId,
      ),
    ).toBe(true)
    expect(await testDb.db.plaidItem.count()).toBe(0)
  })

  it("keeps the bank when Plaid fails for another reason", async () => {
    const deps = makeDeps(fakePlaid().client)
    const { bankId } = await connectBank(deps, "public-token")
    await expect(
      removeBank(
        {
          ...deps,
          plaid: fakePlaid({ removeError: "INTERNAL_SERVER_ERROR" }).client,
        },
        bankId,
      ),
    ).rejects.toBeTruthy()
    expect(await testDb.db.plaidItem.count()).toBe(1)
  })

  it("returns false for an unknown bank", async () => {
    expect(
      await removeBank(
        makeDeps(fakePlaid().client),
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBe(false)
  })
})

describe("listBanks", () => {
  it("summarizes each bank without Plaid IDs or tokens", async () => {
    const deps = makeDeps(fakePlaid().client)
    const { bankId } = await connectBank(deps, "public-token")
    const banks = await listBanks(testDb.db)
    expect(banks).toEqual([
      {
        id: bankId,
        institution: "Test Bank (Sandbox)",
        status: "ok",
        lastErrorCode: null,
        lastSyncedAt: expect.any(String),
        transactionCount: 1,
        accounts: [
          {
            name: "Checking",
            mask: "1234",
            type: "depository",
            subtype: "checking",
          },
        ],
      },
    ])
    expect(JSON.stringify(banks)).not.toMatch(/access-|plaid-item|ins_1|sealed/)
  })
})
