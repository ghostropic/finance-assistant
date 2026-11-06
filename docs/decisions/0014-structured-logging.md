# 0014: Structured logging with no free text

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Before real accounts are connected (M5), the app needs logs that show what it's doing: chat turns, tool calls, syncs and errors, with token counts and timings. [security.md](../security.md) forbids logging transaction details, balances, tool results or full prompts with real data. Rules like that are easy to break by accident, for example by logging `err.message` from a Plaid error, which can include account details and the request's secret headers.

## Decision

One logger, `src/lib/log.ts`, that only accepts a fixed set of typed events (`chat_turn`, `tool_call`, `sync_run`, `http_error`, `startup_check`).

- Each event has a schema, checked when it's written. Fields are numbers, booleans, UUIDs, and strings from fixed sets or strict patterns: Plaid error codes, tool names, error class names.
- There are no free-text fields. An event that doesn't match its schema is dropped, and a `log_rejected` line names only the event.
- The same rules apply in Sandbox and with real data.
- Lines go to `logs/app.jsonl`, and to stdout from the web server. The terminal chat writes to the file only.
- `tests/log-privacy.test.ts` runs a chat turn, a sync and a Plaid error over fixture data and checks that none of the data, the question or the answer appears in the log.

## Why

- The rule is enforced by the logger itself, not by every caller remembering it.
- The same behavior in Sandbox and production means nothing to forget at the switch, and logs from Sandbox show exactly what production logs will hold.
- JSON lines are easy to search with `jq` and to load into something else later.

## Alternatives considered

- **A logger that redacts known sensitive fields:** redaction lists miss new fields, and free text like error messages can't be redacted reliably.
- **Full prompts and tool results in Sandbox only** (security.md allowed it): more useful for debugging, but it means two behaviors, and the stricter one would only be tested once real data arrived.

## Consequences

- Error messages aren't logged, only the error's class and any Plaid code. Debugging means reproducing the problem with Sandbox or fixture data.
- Adding a field means adding it to the schema, which is a deliberate step.
