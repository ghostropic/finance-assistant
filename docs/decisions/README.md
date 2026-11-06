# Decision records

One short file per significant decision: what we chose, why, and what we turned down. When a decision changes, add a new record that supersedes the old one and update the old record's status, rather than rewriting history.

| #                                           | Decision                                      | Status                    |
| ------------------------------------------- | --------------------------------------------- | ------------------------- |
| [0001](0001-nextjs-full-stack.md)           | Next.js for frontend and backend              | Accepted                  |
| [0002](0002-postgres-with-prisma.md)        | Postgres with Prisma, raw SQL for aggregates  | Accepted                  |
| [0003](0003-sync-to-local-db.md)            | Sync Plaid into Postgres; tools query the DB  | Accepted, amended by 0013 |
| [0004](0004-structured-tools.md)            | Structured tools, not model-written SQL       | Accepted                  |
| [0005](0005-hand-written-tool-loop.md)      | Hand-written tool loop with the Anthropic SDK | Accepted                  |
| [0006](0006-sse-over-fetch.md)              | SSE events read through `fetch`               | Accepted                  |
| [0007](0007-local-single-user-read-only.md) | Local, single-user, read-only                 | Accepted                  |
| [0008](0008-tests-on-pglite.md)             | Tests run on PGlite (in-memory Postgres)      | Proposed                  |
| [0009](0009-what-counts-as-spending.md)     | What counts as spending                       | Accepted                  |
| [0010](0010-code-style-guide.md)            | Code style guide                              | Accepted                  |
| [0011](0011-tailwind-and-heroui.md)         | Tailwind CSS and HeroUI                       | Accepted, amended by 0015 |
| [0013](0013-sync-from-chat.md)              | Claude can sync, through `sync_now` only      | Accepted                  |
| [0014](0014-structured-logging.md)          | Structured logging with no free text          | Accepted                  |
| [0015](0015-prettier.md)                    | Prettier for formatting                       | Accepted                  |

## Template

```markdown
# NNNN: Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What problem or question led to this decision.

## Decision

What we chose.

## Why

The reasons.

## Alternatives considered

What else we looked at and why we didn't pick it.

## Consequences

What this makes easier or harder.
```
