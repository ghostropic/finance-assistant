# 0009: What counts as spending

- **Status:** Accepted, refined 2026-10-07 after the first Sandbox run
- **Date:** 2026-10-02

## Context

"How much did I spend?" sounds simple, but a naive sum of money leaving accounts double-counts or includes things that aren't spending. Paying a credit card bill, for example, would count every card purchase twice. Every tool needs to agree on one definition.

## Decision

Spending, defined once in `src/tools/spending.ts`, is the **net** of transactions in spending categories:

- **Excluded:** Plaid primary categories `INCOME`, `TRANSFER_IN` and `TRANSFER_OUT`, the detailed category `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, and **any `LOAN_PAYMENTS` transaction on a credit card account** (added 2026-10-07, see below).
- **Refunds count against their category.** A $10 Amazon refund lowers General Merchandise by $10.
- **Pending transactions are excluded** by default (spending tools accept `include_pending`). `search_transactions` includes them by default, since "show me" questions usually want everything.
- Other loan payments (mortgage, car, student loan) **are** counted as spending, under `LOAN_PAYMENTS`.
- Transactions with no category are reported as `UNCATEGORIZED`.

## Why

- Card payments and transfers between your own accounts move money without spending it.
- Netting refunds matches how people think about it: a returned item wasn't really spent.
- Pending amounts can change or disappear, so totals are steadier without them.

## Alternatives considered

- **Gross outflows (refunds ignored):** Simpler, but overstates spending after returns.
- **Exclude all loan payments:** Would hide large real costs like a mortgage.

## Refinement (2026-10-07)

The first real run against Plaid Sandbox reported a $2,078.50 "loan payment" as September's biggest expense. It was "AUTOMATIC PAYMENT - THANK" on the credit card account: a payment toward the card that Plaid labelled `LOAN_PAYMENTS_OTHER_PAYMENT` instead of `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, so the category rule missed it. It would also have shown up as a $2,078.50 monthly recurring charge.

A loan payment recorded on a credit card account is always a payment toward that card, so those are now excluded whatever their detailed category. Loan payments from checking (mortgage, car, student loan) still count. With the fix, September Sandbox spending went from $3,774.46 to $1,695.96. Fixtures and a test cover both cases.

## Consequences

- Totals depend on Plaid's categorization; a miscategorized transfer would show up as spending.
- Revisit once real data is connected (M5): check how Plaid categorizes your actual transfers and card payments. Sandbox already showed the categories can't be trusted alone.
