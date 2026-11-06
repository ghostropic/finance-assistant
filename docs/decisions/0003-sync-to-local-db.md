# 0003: Sync Plaid into Postgres; tools query the DB

- **Status:** Accepted (amended by [0013](0013-sync-from-chat.md): `sync_now` lets the chat trigger a sync)
- **Date:** 2026-10-02

## Context

Claude needs transaction data to answer questions. It could get it by calling Plaid during the chat, or from a local copy.

## Decision

A separate sync step copies Plaid data into Postgres using `/transactions/sync`. Chat tools only query Postgres; the chat path never calls Plaid.

## Why

- **Fast:** a database query takes milliseconds; a Plaid call takes much longer.
- **Cheap:** questions cost no Plaid API calls.
- **Testable:** tools can be tested against fixed fixture data, and the whole chat can be developed on Sandbox data.
- **Flexible:** questions can use any SQL, not just the filters Plaid's API supports.
- `/transactions/sync` is designed for this: it returns only what changed since a saved cursor.

## Alternatives considered

- **Call Plaid from tools:** Always current, but slow, rate-limited and harder to test, and it limits questions to what Plaid's filters can do.

## Consequences

- Answers are only as current as the last sync, so the UI shows the last-synced time and M3 adds a `sync_now` tool.
- The local database holds real financial data from M5 onward; see [security.md](../security.md).
