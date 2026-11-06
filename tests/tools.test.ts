import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  comparePeriods,
  getBalances,
  recurringCharges,
  searchTransactions,
  spendingByCategory,
  type ToolContext,
} from "@/tools/handlers"
import { runTool, toolDefinitions } from "@/tools"
import { startTestDb, type TestDb } from "./helpers/db"
import { seed, TODAY } from "./helpers/fixtures"

let testDb: TestDb
let ctx: ToolContext

beforeAll(async () => {
  testDb = await startTestDb()
  await seed(testDb.db)
  ctx = { db: testDb.db, today: TODAY }
})
afterAll(() => testDb?.stop())

const SEPT = { start_date: "2026-09-01", end_date: "2026-09-30" }

describe("spending_by_category", () => {
  it("totals September by category, excluding income, transfers, card payments and pending", async () => {
    const r = await spendingByCategory(ctx, SEPT)
    expect(r.total_spent).toBe(1778.98)
    expect(r.categories).toEqual([
      { category: "RENT_AND_UTILITIES", total: 1595, transaction_count: 2 },
      { category: "FOOD_AND_DRINK", total: 106.5, transaction_count: 3 },
      { category: "GENERAL_MERCHANDISE", total: 50, transaction_count: 2 },
      { category: "ENTERTAINMENT", total: 27.48, transaction_count: 2 },
    ])
  })

  it("includes pending transactions only when asked", async () => {
    const r = await spendingByCategory(ctx, { ...SEPT, include_pending: true })
    expect(r.total_spent).toBe(1803.98)
    expect(
      r.categories.find((c) => c.category === "FOOD_AND_DRINK")?.total,
    ).toBe(131.5)
  })

  it("treats both ends of the range as inclusive", async () => {
    const lastDay = await spendingByCategory(ctx, {
      start_date: "2026-09-30",
      end_date: "2026-09-30",
    })
    expect(lastDay.total_spent).toBe(6.5)
    const firstDay = await spendingByCategory(ctx, {
      start_date: "2026-08-31",
      end_date: "2026-08-31",
    })
    expect(firstDay.total_spent).toBe(7)
  })

  it("counts loan payments from checking but not payments toward a credit card", async () => {
    const r = await spendingByCategory(ctx, {
      start_date: "2026-07-01",
      end_date: "2026-07-31",
    })
    expect(r.total_spent).toBe(457.48)
    expect(r.categories.find((c) => c.category === "LOAN_PAYMENTS")).toEqual({
      category: "LOAN_PAYMENTS",
      total: 350,
      transaction_count: 1,
    })
  })

  it("returns an empty result for a period with no data", async () => {
    const r = await spendingByCategory(ctx, {
      start_date: "2020-01-01",
      end_date: "2020-01-31",
    })
    expect(r).toMatchObject({ total_spent: 0, categories: [] })
  })
})

describe("search_transactions", () => {
  it("matches merchants case-insensitively and reports direction and totals", async () => {
    const r = await searchTransactions(ctx, { merchant: "AMAZON" })
    expect(r).toMatchObject({
      match_count: 3,
      shown: 3,
      total_spent: 160,
      total_received: 10,
    })
    expect(r.transactions[0]).toEqual({
      date: "2026-09-22",
      description: "Amazon",
      amount: 10,
      direction: "received",
      category: "GENERAL_MERCHANDISE",
      account: "Rewards Card ••3333",
      pending: false,
    })
  })

  it("caps the list at the limit but totals every match", async () => {
    const r = await searchTransactions(ctx, {
      category: "ENTERTAINMENT",
      limit: 2,
    })
    expect(r.shown).toBe(2)
    expect(r.match_count).toBe(9)
    expect(r.total_spent).toBe(128.91) // 6 x 15.49 + 3 x 11.99
    expect(r.transactions.map((t) => t.date)).toEqual([
      "2026-09-15",
      "2026-09-02",
    ])
  })

  it("filters by direction and amount", async () => {
    const received = await searchTransactions(ctx, {
      direction: "received",
      min_amount: 1000,
    })
    expect(received.match_count).toBe(2)
    expect(
      received.transactions.every((t) => t.description === "ACME PAYROLL"),
    ).toBe(true)

    const small = await searchTransactions(ctx, {
      ...SEPT,
      direction: "spent",
      max_amount: 10,
    })
    expect(small.transactions.map((t) => t.description)).toEqual(["Starbucks"])
  })

  it("treats LIKE wildcards in the merchant text literally", async () => {
    const r = await searchTransactions(ctx, { merchant: "%" })
    expect(r.match_count).toBe(0)
  })

  it("can leave out pending transactions", async () => {
    const all = await searchTransactions(ctx, { merchant: "uber" })
    const posted = await searchTransactions(ctx, {
      merchant: "uber",
      include_pending: false,
    })
    expect(all.match_count).toBe(1)
    expect(posted.match_count).toBe(0)
  })
})

describe("compare_periods", () => {
  it("compares August and September overall and per category", async () => {
    const r = await comparePeriods(ctx, {
      period_a_start: "2026-08-01",
      period_a_end: "2026-08-31",
      period_b_start: "2026-09-01",
      period_b_end: "2026-09-30",
    })
    expect(r.period_a.total_spent).toBe(1774.48)
    expect(r.period_b.total_spent).toBe(1778.98)
    expect(r.difference).toBe(4.5)
    expect(r.percent_change).toBe(0.3)
    expect(r.categories.find((c) => c.category === "FOOD_AND_DRINK")).toEqual({
      category: "FOOD_AND_DRINK",
      period_a: 27,
      period_b: 106.5,
      difference: 79.5,
      percent_change: 294.4,
    })
  })

  it("can compare a single category, with null percent change from zero", async () => {
    const r = await comparePeriods(ctx, {
      period_a_start: "2026-03-01",
      period_a_end: "2026-03-31",
      period_b_start: "2026-04-01",
      period_b_end: "2026-04-30",
      category: "ENTERTAINMENT",
    })
    expect(r.categories).toEqual([
      {
        category: "ENTERTAINMENT",
        period_a: 0,
        period_b: 15.49,
        difference: 15.49,
        percent_change: null,
      },
    ])
  })
})

describe("recurring_charges", () => {
  it("finds monthly subscriptions and skips irregular charges", async () => {
    const r = await recurringCharges(ctx, {})
    expect(
      r.recurring.map((x) => [
        x.merchant,
        x.frequency,
        x.typical_amount,
        x.charge_count,
      ]),
    ).toEqual([
      ["Netflix", "monthly", 15.49, 6],
      ["Spotify", "monthly", 11.99, 3],
    ])
    expect(r.estimated_monthly_total).toBe(27.48)
    expect(r.recurring[0].last_charged).toBe("2026-09-15")
  })

  it("finds yearly charges with a long enough lookback", async () => {
    const r = await recurringCharges(ctx, { lookback_months: 24 })
    const adobe = r.recurring.find((x) => x.merchant === "Adobe")
    expect(adobe).toMatchObject({
      frequency: "yearly",
      typical_amount: 239.88,
      estimated_monthly_cost: 19.99,
    })
  })
})

describe("get_balances", () => {
  it("lists accounts by name and last four digits with totals", async () => {
    const r = await getBalances(ctx)
    expect(r.totals).toEqual({
      cash: 12500,
      investments: 0,
      credit_card_debt: 750.25,
      loan_debt: 0,
      net_worth_estimate: 11749.75,
    })
    expect(r.accounts.map((a) => a.account)).toEqual([
      "Rewards Card ••3333",
      "Everyday Checking ••1111",
      "High Yield Savings ••2222",
    ])
    expect(r.data_as_of).toBe("2026-09-30T08:00:00.000Z")
    expect(JSON.stringify(r)).not.toMatch(/acc-|item-fixture|unused/) // no Plaid IDs or tokens
  })
})

describe("runTool", () => {
  it("returns validation problems as an error instead of throwing", async () => {
    expect(
      await runTool(ctx, "spending_by_category", {
        start_date: "2026-09-31",
        end_date: "2026-09-30",
      }),
    ).toEqual({
      ok: false,
      error: expect.stringContaining("start_date: Not a real date"),
    })
    expect(
      await runTool(ctx, "spending_by_category", {
        start_date: "2026-09-30",
        end_date: "2026-09-01",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("on or before"),
    })
    expect(
      await runTool(ctx, "search_transactions", { limit: 500 }),
    ).toMatchObject({ ok: false })
    expect(
      await runTool(ctx, "search_transactions", { unexpected: true }),
    ).toMatchObject({ ok: false })
    expect(await runTool(ctx, "delete_everything", {})).toEqual({
      ok: false,
      error: 'Unknown tool "delete_everything".',
    })
  })

  it("runs a valid call", async () => {
    const r = await runTool(ctx, "spending_by_category", SEPT)
    expect(r).toMatchObject({ ok: true, result: { total_spent: 1778.98 } })
  })
})

describe("tool definitions", () => {
  it("gives Claude a closed object schema for every tool", () => {
    expect(toolDefinitions.map((t) => t.name)).toEqual([
      "get_balances",
      "spending_by_category",
      "search_transactions",
      "compare_periods",
      "recurring_charges",
      "sync_now",
    ])
    for (const t of toolDefinitions) {
      expect(t.input_schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      })
      expect(t.input_schema).not.toHaveProperty("$schema")
    }
    expect(toolDefinitions[1].input_schema.required).toEqual([
      "start_date",
      "end_date",
    ])
  })
})
