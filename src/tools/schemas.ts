import { z } from "zod"
import { PRIMARY_CATEGORIES } from "./spending"

// Input schemas for every tool. They validate what Claude sends and are also
// converted to the JSON Schema Claude sees (definitions.ts), so the two can't drift.

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    "Not a real date",
  )

const dateRange = <T extends z.ZodRawShape>(
  shape: T,
  startKey: string,
  endKey: string,
) =>
  z
    .object(shape)
    .strict()
    .refine(
      (v: Record<string, unknown>) =>
        !v[startKey] || !v[endKey] || String(v[startKey]) <= String(v[endKey]),
      {
        message: `${startKey} must be on or before ${endKey}`,
      },
    )

const category = z.enum(PRIMARY_CATEGORIES)

export const getBalancesInput = z.object({}).strict()

export const syncNowInput = z.object({}).strict()

export const spendingByCategoryInput = dateRange(
  {
    start_date: isoDate.describe(
      "First day to include, YYYY-MM-DD (inclusive).",
    ),
    end_date: isoDate.describe("Last day to include, YYYY-MM-DD (inclusive)."),
    include_pending: z
      .boolean()
      .optional()
      .describe("Include pending transactions. Defaults to false."),
  },
  "start_date",
  "end_date",
)

export const searchTransactionsInput = dateRange(
  {
    start_date: isoDate
      .optional()
      .describe("First day to include, YYYY-MM-DD (inclusive)."),
    end_date: isoDate
      .optional()
      .describe("Last day to include, YYYY-MM-DD (inclusive)."),
    merchant: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Case-insensitive text matched against the merchant or description.",
      ),
    category: category.optional().describe("Plaid primary category."),
    direction: z
      .enum(["spent", "received", "any"])
      .optional()
      .describe("Money out, money in, or both. Defaults to any."),
    min_amount: z
      .number()
      .nonnegative()
      .optional()
      .describe("Minimum amount in dollars, ignoring direction."),
    max_amount: z
      .number()
      .nonnegative()
      .optional()
      .describe("Maximum amount in dollars, ignoring direction."),
    include_pending: z
      .boolean()
      .optional()
      .describe("Include pending transactions. Defaults to true."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe(
        "Maximum transactions to list, newest first. Defaults to 25, max 50. Totals always cover every match.",
      ),
  },
  "start_date",
  "end_date",
)

export const comparePeriodsInput = z
  .object({
    period_a_start: isoDate.describe(
      "First period start, YYYY-MM-DD (inclusive).",
    ),
    period_a_end: isoDate.describe("First period end, YYYY-MM-DD (inclusive)."),
    period_b_start: isoDate.describe(
      "Second period start, YYYY-MM-DD (inclusive).",
    ),
    period_b_end: isoDate.describe(
      "Second period end, YYYY-MM-DD (inclusive).",
    ),
    category: category
      .optional()
      .describe(
        "Compare only this Plaid primary category. Omit to compare every category.",
      ),
  })
  .strict()
  .refine(
    (v) =>
      v.period_a_start <= v.period_a_end && v.period_b_start <= v.period_b_end,
    {
      message: "Each period's start must be on or before its end",
    },
  )

export const recurringChargesInput = z
  .object({
    lookback_months: z
      .number()
      .int()
      .min(2)
      .max(24)
      .optional()
      .describe(
        "How many months back to look. Defaults to 6; use 13 or more to find yearly charges.",
      ),
  })
  .strict()

export type SpendingByCategoryInput = z.infer<typeof spendingByCategoryInput>
export type SearchTransactionsInput = z.infer<typeof searchTransactionsInput>
export type ComparePeriodsInput = z.infer<typeof comparePeriodsInput>
export type RecurringChargesInput = z.infer<typeof recurringChargesInput>
