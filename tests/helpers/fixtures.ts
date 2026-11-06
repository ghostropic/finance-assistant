import { AccountType } from "plaid"
import type { PrismaClient } from "@/generated/prisma/client"

// A small, fixed data set with known totals. "Today" is 2026-09-30.
//
// Hand-checked expectations used by the tests:
//
// September 2026 spending (pending excluded): 1778.98
//   RENT_AND_UTILITIES   1595.00  rent 1500 + electric 95
//   FOOD_AND_DRINK        106.50  Chipotle 20 + Whole Foods 80 + Starbucks 6.50 (Sep 30, end date)
//   GENERAL_MERCHANDISE    50.00  Amazon 60 - Amazon refund 10
//   ENTERTAINMENT          27.48  Netflix 15.49 + Spotify 11.99
//   Not counted: payroll, savings transfer (both sides), credit card payment (both sides),
//   the card's own "AUTOMATIC PAYMENT" (a loan payment on a credit account, Jul/Aug/Sep),
//   pending Uber Eats 25 (counted only with include_pending), Aug 31 and Oct 1 purchases.
//
// July 2026 spending: 457.48
//   electric 80, car loan from checking 350 (a real loan payment, so it counts),
//   Netflix 15.49, Spotify 11.99. The card autopay (300) is not counted.
//
// August 2026 spending: 1774.48
//   RENT_AND_UTILITIES 1620 (1500 + 120), FOOD_AND_DRINK 27 (15 + 5 + 7), GENERAL_MERCHANDISE 100,
//   ENTERTAINMENT 27.48
//
// Recurring as of 2026-09-30: Netflix monthly 15.49 (Apr-Sep), Spotify monthly 11.99 (Jul-Sep).
//   Not recurring: electric (amounts vary over 10%), Starbucks (2 visits), rent (2 charges in data),
//   the card autopay (monthly, but not spending).
//   Adobe yearly 239.88 (Oct 2024, Oct 2025) appears only with a 24-month lookback.

export const TODAY = "2026-09-30"

type Tx = [
  date: string,
  name: string,
  amount: number,
  primary: string | null,
  detailed?: string | null,
  opts?: { pending?: boolean; merchant?: string | null },
]

export async function seed(db: PrismaClient) {
  const item = await db.plaidItem.create({
    data: {
      plaidItemId: "item-fixture",
      environment: "sandbox",
      institutionName: "Fixture Bank",
      accessTokenEncrypted: "unused",
      lastSyncedAt: new Date("2026-09-30T08:00:00Z"),
    },
  })
  const account = (
    plaidAccountId: string,
    name: string,
    type: AccountType,
    mask: string,
    current: string,
    extra: Record<string, string> = {},
  ) =>
    db.account.create({
      data: {
        plaidItemId: item.id,
        plaidAccountId,
        name,
        type,
        mask,
        currentBalance: current,
        currency: "USD",
        ...extra,
      },
    })

  const checking = await account(
    "acc-checking",
    "Everyday Checking",
    AccountType.Depository,
    "1111",
    "2500.00",
    { availableBalance: "2400.00" },
  )
  const savings = await account(
    "acc-savings",
    "High Yield Savings",
    AccountType.Depository,
    "2222",
    "10000.00",
  )
  const card = await account(
    "acc-card",
    "Rewards Card",
    AccountType.Credit,
    "3333",
    "750.25",
    { creditLimit: "5000.00" },
  )

  const add = (accountId: string, rows: Tx[]) =>
    db.transaction.createMany({
      data: rows.map(([date, name, amount, primary, detailed, opts], i) => ({
        accountId,
        plaidTransactionId: `${accountId}-${date}-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        name,
        merchantName: opts?.merchant === undefined ? name : opts.merchant,
        amount: amount.toFixed(2),
        currency: "USD",
        categoryPrimary: primary,
        categoryDetailed: detailed ?? null,
        pending: opts?.pending ?? false,
      })),
    })

  await add(checking.id, [
    [
      "2026-08-01",
      "Rent",
      1500,
      "RENT_AND_UTILITIES",
      "RENT_AND_UTILITIES_RENT",
    ],
    [
      "2026-09-01",
      "Rent",
      1500,
      "RENT_AND_UTILITIES",
      "RENT_AND_UTILITIES_RENT",
    ],
    [
      "2026-07-10",
      "City Electric",
      80,
      "RENT_AND_UTILITIES",
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    ],
    [
      "2026-08-10",
      "City Electric",
      120,
      "RENT_AND_UTILITIES",
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    ],
    [
      "2026-09-10",
      "City Electric",
      95,
      "RENT_AND_UTILITIES",
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    ],
    [
      "2026-08-15",
      "ACME PAYROLL",
      -3000,
      "INCOME",
      "INCOME_WAGES",
      { merchant: null },
    ],
    [
      "2026-09-15",
      "ACME PAYROLL",
      -3000,
      "INCOME",
      "INCOME_WAGES",
      { merchant: null },
    ],
    [
      "2026-09-20",
      "Transfer to savings",
      500,
      "TRANSFER_OUT",
      "TRANSFER_OUT_ACCOUNT_TRANSFER",
      { merchant: null },
    ],
    [
      "2026-09-25",
      "Rewards Card payment",
      400,
      "LOAN_PAYMENTS",
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      { merchant: null },
    ],
    [
      "2026-07-05",
      "Auto loan payment",
      350,
      "LOAN_PAYMENTS",
      "LOAN_PAYMENTS_CAR_PAYMENT",
      { merchant: null },
    ],
  ])
  await add(savings.id, [
    [
      "2026-09-20",
      "Transfer from checking",
      -500,
      "TRANSFER_IN",
      "TRANSFER_IN_ACCOUNT_TRANSFER",
      { merchant: null },
    ],
  ])
  await add(card.id, [
    [
      "2026-08-05",
      "Chipotle",
      15,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_FAST_FOOD",
    ],
    ["2026-08-12", "Starbucks", 5, "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"],
    [
      "2026-08-31",
      "Corner Deli",
      7,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_RESTAURANT",
    ],
    [
      "2026-08-20",
      "Amazon",
      100,
      "GENERAL_MERCHANDISE",
      "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    ],
    [
      "2026-09-03",
      "Chipotle",
      20,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_FAST_FOOD",
    ],
    [
      "2026-09-10",
      "Whole Foods",
      80,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_GROCERIES",
    ],
    ["2026-09-30", "Starbucks", 6.5, "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"],
    [
      "2026-09-29",
      "Uber Eats",
      25,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_RESTAURANT",
      { pending: true },
    ],
    [
      "2026-10-01",
      "Corner Deli",
      9.99,
      "FOOD_AND_DRINK",
      "FOOD_AND_DRINK_RESTAURANT",
    ],
    [
      "2026-09-18",
      "Amazon",
      60,
      "GENERAL_MERCHANDISE",
      "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    ],
    [
      "2026-09-22",
      "Amazon",
      -10,
      "GENERAL_MERCHANDISE",
      "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    ],
    [
      "2026-09-25",
      "Payment received",
      -400,
      "TRANSFER_IN",
      "TRANSFER_IN_ACCOUNT_TRANSFER",
      { merchant: null },
    ],
    // Plaid Sandbox style: a payment toward the card, labelled as a generic loan payment.
    [
      "2026-07-21",
      "AUTOMATIC PAYMENT - THANK",
      300,
      "LOAN_PAYMENTS",
      "LOAN_PAYMENTS_OTHER_PAYMENT",
      { merchant: null },
    ],
    [
      "2026-08-21",
      "AUTOMATIC PAYMENT - THANK",
      300,
      "LOAN_PAYMENTS",
      "LOAN_PAYMENTS_OTHER_PAYMENT",
      { merchant: null },
    ],
    [
      "2026-09-21",
      "AUTOMATIC PAYMENT - THANK",
      300,
      "LOAN_PAYMENTS",
      "LOAN_PAYMENTS_OTHER_PAYMENT",
      { merchant: null },
    ],
    [
      "2026-04-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-05-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-06-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-07-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-08-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-09-15",
      "Netflix",
      15.49,
      "ENTERTAINMENT",
      "ENTERTAINMENT_TV_AND_MOVIES",
    ],
    [
      "2026-07-02",
      "Spotify",
      11.99,
      "ENTERTAINMENT",
      "ENTERTAINMENT_MUSIC_AND_AUDIO",
    ],
    [
      "2026-08-02",
      "Spotify",
      11.99,
      "ENTERTAINMENT",
      "ENTERTAINMENT_MUSIC_AND_AUDIO",
    ],
    [
      "2026-09-02",
      "Spotify",
      11.99,
      "ENTERTAINMENT",
      "ENTERTAINMENT_MUSIC_AND_AUDIO",
    ],
    [
      "2024-10-20",
      "Adobe",
      239.88,
      "GENERAL_SERVICES",
      "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    ],
    [
      "2025-10-20",
      "Adobe",
      239.88,
      "GENERAL_SERVICES",
      "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    ],
  ])
}
