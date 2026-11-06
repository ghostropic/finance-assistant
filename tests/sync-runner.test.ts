import { TransactionsUpdateStatus } from "plaid"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EnvironmentMismatchError } from "@/lib/environment"
import { createSyncRunner } from "@/sync/runner"
import { startTestDb, type TestDb } from "./helpers/db"
import type { SyncClient } from "@/sync/sync"

const MINUTE = 60_000

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
      institutionName: "Test Bank",
      accessTokenEncrypted: "sealed",
    },
  })
})

/** A Plaid stand-in that counts calls and can hold each call until released. */
function fakePlaid() {
  let release: () => void = () => {}
  let gate: Promise<void> | null = null
  const state = { calls: 0 }
  const client = {
    accountsGet: async () => ({
      data: { accounts: [], item: {}, request_id: "req" },
    }),
    transactionsSync: async () => {
      state.calls++
      if (gate) await gate
      return {
        data: {
          added: [],
          modified: [],
          removed: [],
          accounts: [],
          has_more: false,
          next_cursor: `c${state.calls}`,
          transactions_update_status:
            TransactionsUpdateStatus.HistoricalUpdateComplete,
        },
      }
    },
  } as unknown as SyncClient
  const hold = () => {
    gate = new Promise((resolve) => (release = resolve))
  }
  const releaseAll = () => {
    gate = null
    release()
  }
  return { client, state, hold, releaseAll }
}

const makeRunner = (
  plaid: SyncClient,
  clock = { now: Date.now() },
  environment: "sandbox" | "production" = "sandbox",
) =>
  createSyncRunner({
    db: testDb.db,
    plaid,
    openToken: (s) => `token-${s}`,
    environment,
    now: () => clock.now,
  })

describe("sync runner", () => {
  it("syncs every bank and reports the results", async () => {
    const plaid = fakePlaid()
    const run = await makeRunner(plaid.client).sync({ trigger: "button" })
    expect(run.status).toBe("synced")
    expect(run.banks).toMatchObject([
      { institution: "Test Bank", outcome: "synced" },
    ])
    expect(run.lastSyncedAt).not.toBeNull()
  })

  it("joins a sync already running instead of starting another", async () => {
    const plaid = fakePlaid()
    const runner = makeRunner(plaid.client)
    plaid.hold()
    const first = runner.sync({ trigger: "button" })
    const second = runner.sync({ trigger: "tool", minIntervalMs: 5 * MINUTE })
    await new Promise((resolve) => setTimeout(resolve, 20))
    plaid.releaseAll()
    expect(await second).toBe(await first)
    expect(plaid.state.calls).toBe(1)
  })

  it("skips Plaid within the minimum interval, and syncs again after it", async () => {
    const plaid = fakePlaid()
    const clock = { now: Date.now() }
    const runner = makeRunner(plaid.client, clock)
    await runner.sync({ trigger: "button" })

    clock.now += 4 * MINUTE
    const skipped = await runner.sync({
      trigger: "tool",
      minIntervalMs: 5 * MINUTE,
    })
    expect(skipped).toMatchObject({ status: "up_to_date", banks: [] })
    expect(plaid.state.calls).toBe(1)

    clock.now += 2 * MINUTE
    expect(
      (await runner.sync({ trigger: "tool", minIntervalMs: 5 * MINUTE }))
        .status,
    ).toBe("synced")
    expect(plaid.state.calls).toBe(2)
  })

  it("always syncs without a minimum interval (the Sync button)", async () => {
    const plaid = fakePlaid()
    const runner = makeRunner(plaid.client)
    await runner.sync({ trigger: "button" })
    await runner.sync({ trigger: "button" })
    expect(plaid.state.calls).toBe(2)
  })

  it("runs exclusive work only after a sync in progress finishes", async () => {
    const plaid = fakePlaid()
    const order: string[] = []
    const recording = {
      accountsGet: plaid.client.accountsGet,
      transactionsSync: async (
        ...args: Parameters<SyncClient["transactionsSync"]>
      ) => {
        const response = await plaid.client.transactionsSync(...args)
        order.push("sync")
        return response
      },
    } as SyncClient
    const runner = makeRunner(recording)
    plaid.hold()
    const sync = runner.sync({ trigger: "button" })
    const work = runner.exclusive(async () => order.push("exclusive"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    plaid.releaseAll()
    await Promise.all([sync, work])
    expect(order).toEqual(["sync", "exclusive"])
  })

  it("keeps working after a failed run", async () => {
    const plaid = fakePlaid()
    const runner = makeRunner(plaid.client)
    await expect(
      runner.exclusive(async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom")
    expect((await runner.sync({ trigger: "button" })).status).toBe("synced")
  })

  it("refuses to sync when PLAID_ENV doesn't match the database", async () => {
    const plaid = fakePlaid()
    await expect(
      makeRunner(plaid.client, undefined, "production").sync({
        trigger: "button",
      }),
    ).rejects.toBeInstanceOf(EnvironmentMismatchError)
    expect(plaid.state.calls).toBe(0)
  })
})
