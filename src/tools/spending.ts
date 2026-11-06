import { AccountType } from "plaid"
import { Prisma } from "@/generated/prisma/client"

// What counts as "spending" lives here, once, so every tool agrees.
//
// Plaid amounts: positive = money out, negative = money in. Spending is the
// net of transactions in spending categories, so a refund (negative amount in
// a spending category) reduces the total it belongs to. Moving money between
// your own accounts and income are not spending, and paying a credit card
// bill isn't either: the purchases on the card are already counted.
//
// Plaid doesn't always label card payments as LOAN_PAYMENTS_CREDIT_CARD_PAYMENT
// (Sandbox's "AUTOMATIC PAYMENT - THANK" on the card is LOAN_PAYMENTS_OTHER_PAYMENT),
// so any loan payment recorded on a credit card account is excluded too. Real
// loan payments (mortgage, car) made from checking still count.

export const PRIMARY_CATEGORIES = [
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "INCOME",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "TRANSPORTATION",
  "TRAVEL",
] as const

export type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number]

export const LOAN_PAYMENTS: PrimaryCategory = "LOAN_PAYMENTS"
export const NON_SPENDING_PRIMARY: PrimaryCategory[] = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]
export const NON_SPENDING_DETAILED = [
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
] as const
/** Loan payments on these account types are payments toward the account itself. */
export const PAYMENT_ONLY_ACCOUNT_TYPES = [AccountType.Credit] as const

export const UNCATEGORIZED = "UNCATEGORIZED"

/** SQL condition selecting spending transactions on the `t` alias. */
export function buildSpendingFilter(includePending: boolean): Prisma.Sql {
  return Prisma.sql`
    COALESCE(t.category_primary, '') NOT IN (${Prisma.join(NON_SPENDING_PRIMARY)})
    AND COALESCE(t.category_detailed, '') NOT IN (${Prisma.join([...NON_SPENDING_DETAILED])})
    AND NOT (
      t.category_primary = ${LOAN_PAYMENTS}
      AND t.account_id IN (SELECT id FROM accounts WHERE type IN (${Prisma.join([...PAYMENT_ONLY_ACCOUNT_TYPES])}))
    )
    ${includePending ? Prisma.empty : Prisma.sql`AND t.pending = false`}
  `
}

/** Category label as tools report it. */
export const CATEGORY_LABEL_SQL = Prisma.sql`COALESCE(t.category_primary, ${UNCATEGORIZED})`
