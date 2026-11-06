# Plan

## Goal

Build a chat app where I can ask questions about my own finances and get answers grounded in my real transaction data.

It's mainly a learning project. The things I want to practice are:

- The Claude tool-use loop, written by hand rather than hidden behind a framework
- Streaming responses to a React UI over SSE
- Designing tools (names, inputs, how much data they return)
- Working with a real third-party API (Plaid) and syncing its data
- Measuring quality with evals and logging, not just eyeballing output

Why personal finance: a general-purpose assistant with web search can't answer "How much did I spend eating out this quarter compared with last?" The answer depends on private data, which is the use case where tools are actually necessary.

## Scope

- **One user (me), running locally.** No sign-up, login or multi-tenancy.
- **Read-only.** The app reads balances and transactions. It never moves money.
- **Plaid Sandbox first.** Everything is built and tested on fake data. Real accounts come last.

## Architecture

```
[Plaid] ──sync (on demand / at startup)──▶ [Postgres]
                                               ▲
[Browser] ──POST /api/chat──▶ [Next.js route] ─┤
     ▲                            │            │
     └──── SSE events ◀───────────┤  tool calls│
                                  ▼            │
                              [Claude API] ────┘
```

Two separate paths:

1. **Sync.** Pulls new and changed transactions and current balances from Plaid into Postgres, using Plaid's `/transactions/sync` and a saved cursor.
2. **Chat.** The route handler runs the tool loop: it sends the conversation to Claude, runs any tools Claude asks for against Postgres, sends the results back and repeats until Claude gives a final answer. Text and tool activity stream to the browser as they happen.

The chat path never calls Plaid. Answers are fast, a question costs no Plaid calls, and the chat can be developed and tested entirely on Sandbox data.

## Key decisions

Each has its own record in [decisions/](decisions/) with the reasoning and alternatives.

| #                                                     | Decision                                           | Short reason                                                  |
| ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| [0001](decisions/0001-nextjs-full-stack.md)           | Next.js for frontend and backend                   | One project, server-side API keys, React/TS frontend included |
| [0002](decisions/0002-postgres-with-prisma.md)        | Postgres with Prisma, raw SQL for aggregates       | Real database to practice with; typed schema and migrations   |
| [0003](decisions/0003-sync-to-local-db.md)            | Sync Plaid into Postgres; tools query the DB       | Fast, cheap, testable; chat doesn't depend on Plaid           |
| [0004](decisions/0004-structured-tools.md)            | Structured tools, not model-written SQL (at first) | Predictable, safe, easy to test                               |
| [0005](decisions/0005-hand-written-tool-loop.md)      | Hand-written tool loop with the Anthropic SDK      | Learning how the loop actually works                          |
| [0006](decisions/0006-sse-over-fetch.md)              | SSE events read through `fetch`, not `EventSource` | Chat needs a POST body                                        |
| [0007](decisions/0007-local-single-user-read-only.md) | Local, single-user, read-only                      | Keeps scope small and risk low with real financial data       |
| [0008](decisions/0008-tests-on-pglite.md)             | Tests on PGlite (in-memory Postgres)               | Real Postgres in tests with nothing to run                    |
| [0009](decisions/0009-what-counts-as-spending.md)     | What counts as spending                            | One definition every tool shares                              |

## Milestones

| Milestone                                                                | What it delivers                                                                                                                                                                                                           | Done when                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **M1: Data and agent core** ([details](milestone-1.md)), done 2026-10-07 | Postgres schema, Sandbox setup, sync, tool functions, terminal chat, tests                                                                                                                                                 | A terminal question gets a correct answer from Sandbox data, with tool calls shown        |
| **M2: Web chat** ([details](milestone-2.md)), done 2026-10-08            | `POST /api/chat` with SSE streaming; React chat UI showing streamed text and tool activity                                                                                                                                 | The same questions work in the browser, streaming                                         |
| **M3: Connecting banks** ([details](milestone-3.md)), done 2026-10-21    | Plaid Link in the UI, a sync button, a last-synced time, a `sync_now` tool                                                                                                                                                 | A bank can be connected and synced from the app                                           |
| **M4: Quality** ([details](milestone-4.md))                              | Part 1: structured logging of tokens, tool calls, latency and failures; token usage saved per turn; duplicate banks refused before the token exchange. Part 2: an eval set of questions with known answers on fixture data | Part 1 before any real bank is connected. Evals run with one command and show a pass rate |
| **M5: Real data** ([details](milestone-5.md))                            | Plaid production access, a separate database, real accounts connected                                                                                                                                                      | Real accounts sync, with M4's logging in place                                            |

Each milestone gets its own doc in `docs/` when it starts.

### Switching to real data (M5)

Real data goes into its own database, `finance_assistant_production`. The existing `finance_assistant` database keeps the Sandbox data for evals and development. M3's environment check refuses to connect or sync if `PLAID_ENV` and the database don't match.

1. Review Anthropic's API data-retention policy ([security.md](security.md#what-is-sent-to-claude)).
2. Create the database in the running container: `docker compose exec postgres createdb -U finance finance_assistant_production`.
3. Apply the migrations to it: `DATABASE_URL=postgresql://finance:finance@localhost:5432/finance_assistant_production npx prisma migrate deploy`.
4. In `.env`, set `DATABASE_URL` to the new database, `PLAID_ENV=production` and the production `PLAID_SECRET`. Keep the Sandbox values in a comment to switch back.
5. Start the app and connect banks through the Banks panel. Do this only once M4 part 1 (logging) is done.

Switching back to Sandbox means changing `DATABASE_URL` and `PLAID_ENV` (and the secret) together.

## Ideas for later

- A read-only SQL tool, compared against the structured tools using the eval set
- Budgets and alerts ("tell me when dining goes over $400 this month")
- Charts in the chat for spending over time
- **Other model providers (OpenRouter).** Decided 2026-10-07 to stay on the Anthropic API directly for now. Two later steps if wanted:
  1. Point the existing Anthropic SDK at OpenRouter's Anthropic-compatible endpoint (`https://openrouter.ai/api`). This is a config change, Claude models only, and the refusal-fallback beta likely won't carry over.
  2. Add a provider adapter for OpenAI-format models. The loop already emits its own events, so an adapter only translates tool definitions, tool calls and results, streamed chunks and reasoning data. A good fit for comparing models in the M4 evals.

  Either step adds another party that sees transaction data: write a decision record and update `security.md` first.

- **A cheap classifier for sync-time decisions**, such as "is this a transfer?" or "is this a subscription?". Compare TypeSafe's Jev with Claude Haiku 4.5 and structured outputs, on Sandbox data, using the eval set.

## Open questions

- Plaid production access, started early because approval can take time (see [milestone-4.md](milestone-4.md#plaid-production-access-yours-in-parallel)): which plan the team is on (Trial or Limited Production), and whether the security questionnaire is needed before Chase and other OAuth banks can be connected.
- Decision 0008 (tests on PGlite) was made during M1 and is marked Proposed until reviewed.
