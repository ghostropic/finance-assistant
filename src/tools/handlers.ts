import { AccountType } from "plaid"
import { Prisma } from "@/generated/prisma/client"
import { CATEGORY_LABEL_SQL, buildSpendingFilter } from "./spending"
import type { PrismaClient } from "@/generated/prisma/client"
import type { SyncRunner } from "@/sync/runner"
import type {
  ComparePeriodsInput,
  RecurringChargesInput,
  SearchTransactionsInput,
  SpendingByCategoryInput,
} from "./schemas"

// Amounts leave here as positive "spent" or "received" numbers, so Claude never
// has to know Plaid's sign convention. Results never include Plaid IDs, access
// tokens or full account numbers (docs/security.md).

const DEFAULT_SEARCH_LIMIT = 25
const DEFAULT_LOOKBACK_MONTHS = 6
const MS_PER_DAY = 86_400_000
const MIN_REGULAR_SHARE = 0.8
const AMOUNT_TOLERANCE = 0.1

const RECURRING_FREQUENCIES = [
  {
    name: "weekly",
    minGapDays: 5,
    maxGapDays: 9,
    minCharges: 3,
    perMonth: 52 / 12,
  },
  {
    name: "every two weeks",
    minGapDays: 12,
    maxGapDays: 16,
    minCharges: 3,
    perMonth: 26 / 12,
  },
  {
    name: "monthly",
    minGapDays: 26,
    maxGapDays: 35,
    minCharges: 3,
    perMonth: 1,
  },
  {
    name: "quarterly",
    minGapDays: 85,
    maxGapDays: 97,
    minCharges: 3,
    perMonth: 1 / 3,
  },
  {
    name: "yearly",
    minGapDays: 350,
    maxGapDays: 380,
    minCharges: 2,
    perMonth: 1 / 12,
  },
] as const

export interface ToolContext {
  db: PrismaClient
  /** Today's date, YYYY-MM-DD. Injected so tests can fix it. */
  today: string
  /** For sync_now. Absent where Plaid isn't configured, such as the terminal chat without Plaid keys. */
  sync?: SyncRunner
}

interface CategoryRow {
  category: string
  total: number
  transaction_count: number
}

interface SearchRow {
  date: Date
  description: string
  amount: number
  category: string
  account: string
  mask: string | null
  pending: boolean
}

interface SearchTotals {
  match_count: number
  total_spent: number
  total_received: number
}

interface CompareRow {
  category: string
  period_a: number
  period_b: number
}

interface ChargeRow {
  merchant_key: string
  description: string
  date: Date
  amount: number
}

type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]

const roundToCents = (value: number) => Math.round(value * 100) / 100

const toAmount = (
  value: Prisma.Decimal | number | string | null | undefined,
) => (value == null ? null : roundToCents(Number(value)))

const toIsoDay = (date: Date) => date.toISOString().slice(0, 10)

const formatAccountLabel = (name: string, mask: string | null) =>
  mask ? `${name} ••${mask}` : name

const escapeLikePattern = (text: string) =>
  text.replace(/[\\%_]/g, (char) => `\\${char}`)

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const isWithinBand = (gapDays: number, frequency: RecurringFrequency) =>
  gapDays >= frequency.minGapDays && gapDays <= frequency.maxGapDays

const daysBetween = (earlier: Date, later: Date) =>
  Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY)

const describeChange = (before: number, after: number) => ({
  difference: roundToCents(after - before),
  percent_change:
    before === 0
      ? null
      : Math.round(((after - before) / Math.abs(before)) * 1000) / 10,
})

const groupByMerchant = (charges: ChargeRow[]) => {
  const groups = new Map<string, ChargeRow[]>()
  for (const charge of charges)
    groups.set(charge.merchant_key, [
      ...(groups.get(charge.merchant_key) ?? []),
      charge,
    ])
  return [...groups.values()]
}

const mapChargesToRecurring = (charges: ChargeRow[]) => {
  if (charges.length < 2) return null

  const gaps = charges
    .slice(1)
    .map((charge, i) => daysBetween(charges[i].date, charge.date))
  const frequency = RECURRING_FREQUENCIES.find((f) =>
    isWithinBand(median(gaps), f),
  )
  if (!frequency || charges.length < frequency.minCharges) return null

  const amounts = charges.map((charge) => charge.amount)
  const typical = median(amounts)
  const regularGapShare =
    gaps.filter((gap) => isWithinBand(gap, frequency)).length / gaps.length
  const steadyAmountShare =
    amounts.filter((a) => Math.abs(a - typical) <= typical * AMOUNT_TOLERANCE)
      .length / amounts.length
  if (
    regularGapShare < MIN_REGULAR_SHARE ||
    steadyAmountShare < MIN_REGULAR_SHARE
  )
    return null

  const last = charges[charges.length - 1]
  return {
    merchant: last.description,
    frequency: frequency.name,
    typical_amount: roundToCents(typical),
    estimated_monthly_cost: roundToCents(typical * frequency.perMonth),
    charge_count: charges.length,
    last_charged: toIsoDay(last.date),
    last_amount: roundToCents(last.amount),
  }
}

export async function getBalances({ db }: ToolContext) {
  const [accounts, items] = await Promise.all([
    db.account.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.plaidItem.findMany({
      select: { institutionName: true, lastSyncedAt: true },
    }),
  ])

  const sumBalances = (type: AccountType) =>
    roundToCents(
      accounts
        .filter((a) => a.type === type)
        .reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0),
    )
  const cash = sumBalances(AccountType.Depository)
  const investments = sumBalances(AccountType.Investment)
  const creditOwed = sumBalances(AccountType.Credit)
  const loansOwed = sumBalances(AccountType.Loan)
  const syncTimes = items
    .map((i) => i.lastSyncedAt?.getTime())
    .filter((t): t is number => t != null)

  return {
    accounts: accounts.map((a) => ({
      account: formatAccountLabel(a.name, a.mask),
      type: a.type,
      subtype: a.subtype,
      current_balance: toAmount(a.currentBalance),
      available_balance: toAmount(a.availableBalance),
      credit_limit: toAmount(a.creditLimit),
      currency: a.currency,
    })),
    totals: {
      cash,
      investments,
      credit_card_debt: creditOwed,
      loan_debt: loansOwed,
      net_worth_estimate: roundToCents(
        cash + investments - creditOwed - loansOwed,
      ),
    },
    institutions: items.map((i) => i.institutionName ?? "Unknown institution"),
    data_as_of: syncTimes.length
      ? new Date(Math.min(...syncTimes)).toISOString()
      : null,
  }
}

export async function spendingByCategory(
  { db }: ToolContext,
  input: SpendingByCategoryInput,
) {
  const includePending = input.include_pending ?? false
  const rows = await db.$queryRaw<CategoryRow[]>`
    SELECT ${CATEGORY_LABEL_SQL} AS category,
           ROUND(SUM(t.amount), 2)::float8 AS total,
           COUNT(*)::int AS transaction_count
    FROM transactions t
    WHERE t.date BETWEEN ${input.start_date}::date AND ${input.end_date}::date
      AND ${buildSpendingFilter(includePending)}
    GROUP BY 1
    HAVING SUM(t.amount) <> 0
    ORDER BY total DESC, category`

  return {
    period: { start: input.start_date, end: input.end_date },
    total_spent: roundToCents(rows.reduce((sum, r) => sum + r.total, 0)),
    categories: rows,
    pending_included: includePending,
  }
}

export async function searchTransactions(
  { db }: ToolContext,
  input: SearchTransactionsInput,
) {
  const conditions: Prisma.Sql[] = []
  if (input.start_date)
    conditions.push(Prisma.sql`t.date >= ${input.start_date}::date`)
  if (input.end_date)
    conditions.push(Prisma.sql`t.date <= ${input.end_date}::date`)
  if (input.merchant) {
    const pattern = `%${escapeLikePattern(input.merchant)}%`
    conditions.push(
      Prisma.sql`(t.merchant_name ILIKE ${pattern} OR t.name ILIKE ${pattern})`,
    )
  }
  if (input.category)
    conditions.push(Prisma.sql`t.category_primary = ${input.category}`)
  if (input.direction === "spent") conditions.push(Prisma.sql`t.amount > 0`)
  if (input.direction === "received") conditions.push(Prisma.sql`t.amount < 0`)
  if (input.min_amount != null)
    conditions.push(Prisma.sql`ABS(t.amount) >= ${input.min_amount}`)
  if (input.max_amount != null)
    conditions.push(Prisma.sql`ABS(t.amount) <= ${input.max_amount}`)
  if (input.include_pending === false)
    conditions.push(Prisma.sql`t.pending = false`)

  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT

  const [rows, totals] = await Promise.all([
    db.$queryRaw<SearchRow[]>`
      SELECT t.date,
             COALESCE(t.merchant_name, t.name) AS description,
             t.amount::float8 AS amount,
             ${CATEGORY_LABEL_SQL} AS category,
             a.name AS account,
             a.mask,
             t.pending
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      ${where}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ${limit}`,
    db.$queryRaw<SearchTotals[]>`
      SELECT COUNT(*)::int AS match_count,
             COALESCE(ROUND(SUM(t.amount) FILTER (WHERE t.amount > 0), 2), 0)::float8 AS total_spent,
             COALESCE(ROUND(-SUM(t.amount) FILTER (WHERE t.amount < 0), 2), 0)::float8 AS total_received
      FROM transactions t
      ${where}`,
  ])

  const { match_count, total_spent, total_received } = totals[0]
  return {
    match_count,
    shown: rows.length,
    total_spent,
    total_received,
    transactions: rows.map((r) => ({
      date: toIsoDay(r.date),
      description: r.description,
      amount: roundToCents(Math.abs(r.amount)),
      direction: r.amount >= 0 ? "spent" : "received",
      category: r.category,
      account: formatAccountLabel(r.account, r.mask),
      pending: r.pending,
    })),
  }
}

export async function comparePeriods(
  { db }: ToolContext,
  input: ComparePeriodsInput,
) {
  const onlyCategory = input.category
    ? Prisma.sql`AND t.category_primary = ${input.category}`
    : Prisma.empty
  const inA = Prisma.sql`t.date BETWEEN ${input.period_a_start}::date AND ${input.period_a_end}::date`
  const inB = Prisma.sql`t.date BETWEEN ${input.period_b_start}::date AND ${input.period_b_end}::date`

  const rows = await db.$queryRaw<CompareRow[]>`
    SELECT ${CATEGORY_LABEL_SQL} AS category,
           COALESCE(ROUND(SUM(t.amount) FILTER (WHERE ${inA}), 2), 0)::float8 AS period_a,
           COALESCE(ROUND(SUM(t.amount) FILTER (WHERE ${inB}), 2), 0)::float8 AS period_b
    FROM transactions t
    WHERE ((${inA}) OR (${inB}))
      AND ${buildSpendingFilter(false)}
      ${onlyCategory}
    GROUP BY 1
    ORDER BY GREATEST(ABS(COALESCE(SUM(t.amount) FILTER (WHERE ${inA}), 0)), ABS(COALESCE(SUM(t.amount) FILTER (WHERE ${inB}), 0))) DESC, 1`

  const totalA = roundToCents(rows.reduce((sum, r) => sum + r.period_a, 0))
  const totalB = roundToCents(rows.reduce((sum, r) => sum + r.period_b, 0))

  return {
    period_a: {
      start: input.period_a_start,
      end: input.period_a_end,
      total_spent: totalA,
    },
    period_b: {
      start: input.period_b_start,
      end: input.period_b_end,
      total_spent: totalB,
    },
    ...describeChange(totalA, totalB),
    note: "difference = period_b - period_a; percent_change is null when period_a is 0",
    categories: rows.map((r) => ({
      ...r,
      ...describeChange(r.period_a, r.period_b),
    })),
  }
}

export async function recurringCharges(
  { db, today }: ToolContext,
  input: RecurringChargesInput,
) {
  const months = input.lookback_months ?? DEFAULT_LOOKBACK_MONTHS
  const charges = await db.$queryRaw<ChargeRow[]>`
    SELECT LOWER(COALESCE(t.merchant_name, t.name)) AS merchant_key,
           COALESCE(t.merchant_name, t.name) AS description,
           t.date,
           t.amount::float8 AS amount
    FROM transactions t
    WHERE t.amount > 0
      AND t.date > (${today}::date - make_interval(months => ${months}::int))
      AND t.date <= ${today}::date
      AND ${buildSpendingFilter(false)}
    ORDER BY merchant_key, t.date`

  const recurring = groupByMerchant(charges)
    .map(mapChargesToRecurring)
    .filter((r) => r !== null)
    .sort((a, b) => b.estimated_monthly_cost - a.estimated_monthly_cost)

  return {
    lookback: { months, through: today },
    estimated_monthly_total: roundToCents(
      recurring.reduce((sum, r) => sum + r.estimated_monthly_cost, 0),
    ),
    recurring,
    method:
      "Same merchant charged at a regular interval (weekly to yearly) with amounts within 10% of typical; 3+ charges needed (2 for yearly).",
  }
}
