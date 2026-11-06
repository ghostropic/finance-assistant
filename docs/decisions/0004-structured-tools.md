# 0004: Structured tools, not model-written SQL

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Claude needs a way to query the transaction data. It could write SQL itself, or call a fixed set of tools with typed inputs.

## Decision

Start with five structured tools: `get_balances`, `spending_by_category`, `search_transactions`, `compare_periods` and `recurring_charges`.

## Why

- **Predictable:** the same input always produces the same query, so results can be tested exactly.
- **Safe:** no risk of the model writing a slow or wrong query, and no way to read tables it shouldn't.
- **Encodes domain rules once:** the sign convention, pending exclusion and date handling live in code instead of being re-derived by the model on every question.
- **Controls output size:** each tool returns only a compact summary.

## Alternatives considered

- **A read-only SQL tool:** Far more flexible; answers questions no tool anticipated. Kept as a later experiment, compared against these tools using the eval set.

## Consequences

- Questions the tools don't cover get partial answers or none, so the system prompt tells Claude to say so instead of guessing.
- New kinds of question may need new tools.
