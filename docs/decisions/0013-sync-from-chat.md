# 0013: Claude can sync, through `sync_now` only

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

[0003](0003-sync-to-local-db.md) keeps Plaid out of the chat path: tools only query Postgres. Answers are then only as fresh as the last sync, and a question like "what did I spend today?" can be answered from day-old data without the user noticing.

## Decision

Add one tool, `sync_now`, that runs the same sync as the Sync button. Every other tool still only reads Postgres. Its limits:

- **Shared lock:** it goes through the same in-process sync runner as the button (`src/sync/runner.ts`). If a sync is running, it joins it instead of starting another.
- **Throttled:** if the last sync was under 5 minutes ago, it returns `up_to_date` without calling Plaid.
- **Counts only:** per bank, a status and added, updated and removed counts. No transaction details. Claude reads the new data with the other tools.
- **60-second timeout,** instead of the other tools' 15 seconds.
- **Used sparingly:** its description and the system prompt limit it to requests for fresh data, or questions about the last day or two when the data is older.
- **Refuses** when `PLAID_ENV` doesn't match the database (see [milestone-3.md](../milestone-3.md)).

## Why

- Freshness is part of answering correctly, and Claude can tell when a question needs it.
- Reusing the button's sync means one code path, one lock and one set of tests.
- Returning counts keeps the rule that tool results are compact summaries, and nothing new reaches Claude that the query tools wouldn't send anyway.

## Alternatives considered

- **Webhooks:** Plaid would push "new transactions" notices, but they need a public URL, which breaks [0007](0007-local-single-user-read-only.md).
- **Sync before every answer:** slow, and wasteful when the data is minutes old.
- **Query Plaid directly from tools:** rejected in 0003 for speed, cost and testability; still true.

## Consequences

- A chat turn can now take as long as a Plaid sync (usually seconds, at most 60 seconds before the tool gives up).
- `sync_now` fetches what Plaid already has. Plaid refreshes from banks a few times a day; forcing a bank refresh (`/transactions/refresh`) is a paid add-on and not used.
- The terminal chat has no Plaid client, so there `sync_now` reports that syncing isn't available.
