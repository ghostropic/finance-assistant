# Milestone 5: Real data

**Goal:** The app answers questions about real accounts, with M4's logging in place.

**Done when:** real banks are connected through Plaid Link in Production and sync completely, with nothing sensitive in the logs.

## Status (2026-10-26)

**In progress.** Switched to Production, and two real banks are connected. A sync bug found on the first real sync is fixed, and the full resync to recover from it is pending.

- **Plaid:** the team is on the free Trial plan (10 connections). Chase and other OAuth banks work on a Trial without the security questionnaire. A removed connection doesn't free its slot, so banks are connected once and repaired with Reconnect.
- **Database:** `finance_assistant_production`, created and migrated as in [plan.md](plan.md#switching-to-real-data-m5). The Sandbox database (`finance_assistant`) is untouched.
- **Logs only:** production checks use `logs/app.jsonl`, which holds counts and codes only. Real transaction data is never used for debugging or test fixtures.

## Found on the first real sync

### Transactions dropped when a sync spans several pages

The first bank's first sync logged `added: 1285, skipped: 760`. Plaid's `/transactions/sync` lists, in each response, "only accounts that have associated transactions" in that response, and sync kept only the last page's list. Every transaction on an earlier page whose account didn't appear again on the last page was skipped, and the cursor moved past it, so later syncs would never have sent it. Sandbox never showed this, because its small data sets fit on one page.

Fixes (`src/sync/sync.ts`, tests in `tests/sync.test.ts`):

- Accounts are collected across all pages, with the bank's saved accounts as a fallback.
- Every sync also calls `/accounts/get`, so accounts with no new transactions still get fresh balances, and accounts with no transactions at all still appear.
- `added` and `modified` count only what was saved. `skipped` is what couldn't be.
- **Full resync:** `npm run sync -- --full` clears each bank's cursor, so Plaid sends the whole history again. Saving is idempotent. Once Plaid reports the history complete (`HISTORICAL_UPDATE_COMPLETE`), transactions it no longer has are deleted, such as pending ones that have since posted. Before that, nothing is deleted, because Plaid sends only recent transactions at first.

## Still to do

- Restart the dev server (its sync runner holds the old code), then run `npm run sync -- --full`. The logs should show `skipped: 0`.
- Revisit [0009](decisions/0009-what-counts-as-spending.md): check in the app how Plaid categorizes real transfers and card payments.
