# Milestone 4: Quality (logging and evals)

**Goal:** See what the app does without reading code, and know how good its answers are, with a number. Logging comes first, so it's proven safe before any real transaction exists.

**Done when:**

- **Part 1:** every chat turn, tool call and sync writes a structured log line with nothing sensitive in it, and a test proves it. Token usage survives a page reload. A duplicate bank is refused before its token is exchanged. Real banks (M5) aren't connected until this is done.
- **Part 2:** `npm run eval` runs a set of questions with known answers against the real Claude API and prints a pass rate, with tokens and latency per question.

## Status (2026-10-21)

**Part 1 done** (2026-10-21). Part 2 not started.

- Logging: `src/lib/log.ts` and [0014](decisions/0014-structured-logging.md). On the dev server, a restart logged `startup_check`, the Sync button `sync_run` (trigger `button`), and real chat turns `tool_call` and `chat_turn` lines, with the real model ID, stop reason and token counts. No line was rejected.
- Token usage showed under an answer after a page reload.
- `tests/log-privacy.test.ts` passes: a chat turn with four tool calls (one invalid), a sync with a failing bank, and Plaid and internal errors whose details hold data and secrets log none of it.
- Token usage per turn (`turn_metrics`) and the duplicate check before the exchange, both with tests. 113 tests pass, along with lint and typecheck.
- **Plaid:** the team is on the free Trial plan (10 connections). Chase and other OAuth banks work on a Trial without the security questionnaire, so M5 needs no paperwork. A removed connection doesn't free its slot, so real banks are connected once and repaired with Reconnect.
- **Found:** a running dev server keeps its Prisma client and sync runner on `globalThis` across hot reloads, so after a migration it fails until restarted ("Cannot read properties of undefined"). README troubleshooting now says to restart after `npm run db:migrate`.

## Order, and where real data fits

1. **M4 part 1: logging, usage, duplicate check.** Required before real data.
2. **M5: real data.** Waits for part 1 and Plaid's approval, which runs in parallel (below). Steps in [plan.md](plan.md#switching-to-real-data-m5).
3. **M4 part 2: evals.** They run on fixture data, so they don't depend on M5 and can land before or after it.

## Plaid production access (yours, in parallel)

Current Sandbox keys only reach fake banks. From Plaid's docs, as of 2026-10-21:

- **Trial plan:** Plaid teams created on or after 2026-04-15 get a free Trial with 10 Production Items, Transactions included, and almost every institution before full approval. **Removing an Item doesn't free its slot.**
- **Limited Production:** older teams have this instead. It has capped API calls and Items, and no Chase, Bank of America or Wells Fargo until full Production.
- **Full Production:** requested through a form in the Dashboard. Pay-as-you-go has no minimum. Transactions is billed per Item per month while its access token exists, and `/item/remove` stops billing.
- **OAuth banks (Chase and most large banks):** need the Dashboard compliance center: a public app profile, company information, the latest MSA and a security questionnaire. Chase requires the questionnaire. Plaid says to submit it early because review takes time. Trial users can defer this until they upgrade.
- **Localhost is fine:** on desktop web, Link opens OAuth banks in a pop-up and needs no redirect URI. Redirect URIs must be HTTPS, and localhost is only allowed in Sandbox.

Steps:

1. In the Plaid Dashboard, check whether the team is on a Trial plan or Limited Production.
2. Request Production access for **Transactions only**.
3. Start the security questionnaire. Claude can draft answers from [security.md](security.md) for you to review and submit.

## Part 1 deliverables

1. **Structured logging** (`src/lib/log.ts`): typed events, JSON lines, validated so nothing sensitive can be written
2. **Every existing `console.*` call** in `src/` moved onto the logger
3. **A test** that runs a fixture chat turn and a sync, and checks the logs contain no merchant names, amounts or prompt text
4. **Token usage saved per turn** (`turn_metrics`) and shown again after a reload (M2 follow-up)
5. **Duplicate banks refused before the exchange,** following Plaid's guidance
6. **Decision record** for the logging design

## Part 2 deliverables

1. An eval set: about 25 questions with known answers, run against the fixture data
2. `npm run eval`: runs the set through the real loop, grades each answer, and prints and saves a report
3. Graders: deterministic checks (numbers, tools called, required and forbidden wording), with unit tests
4. The M2 refund bug fixed, test-first, with an eval case that would have caught it
5. Decision record for the eval approach

## Part 1 decisions

### Logging

- **Typed events, written as JSON lines** to `logs/app.jsonl` (gitignored), and also to stdout from the web server:
  - `chat_turn`: conversation ID, model, effort, rounds, stop reason, tokens (input, output, cache read, cache write), duration, tool calls, error kind
  - `tool_call`: tool name, ok or error kind (invalid input, timeout, failed, unknown tool), duration
  - `sync_run`: trigger (button, tool, page open, connect), result, bank count, outcomes per kind, Plaid error codes, duration
  - `plaid_error`: operation (link token, exchange, item get, item remove), error code
  - `http_error`: route, status, error kind
- **Nothing sensitive by construction:** each event has a fixed schema, checked when it's written. Every field is a number, a boolean, a UUID, or a string from a fixed set or a strict pattern (Plaid error codes are `A_Z_` only). There's no free-text field. An event that doesn't match is dropped, and a `log_rejected` line records only its event name. So a transaction, balance, prompt, tool result or error message can't reach the log, even by mistake.
- **The same rules in Sandbox and with real data,** so nothing changes at the switch. That's stricter than [security.md](security.md) requires for Sandbox, and simpler.
- The terminal chat writes to the file only, so log lines don't appear in the middle of the conversation.

### Token usage is saved per turn

A new `turn_metrics` table: conversation, the turn's position, model, effort, tokens, rounds, duration, created. It's saved in the same database transaction as the turn's messages. The conversation route returns it, so usage shows under each answer after a reload. The same rows can answer "what has this cost so far?" later.

### Duplicate banks are refused before the exchange

Plaid's guidance is to compare Link's `onSuccess` metadata with existing Items, and not to exchange the public token if it's a duplicate, because the duplicate Item is created when an access token is requested. On a Trial plan, a removed Item still uses one of the 10 slots.

- The browser sends Link's `institution_id` with the public token.
- The server refuses before exchanging if a bank with that institution is already connected.
- The check after the exchange (M3) stays as a backstop, because the browser's value is only a hint.
- Plaid's docs don't say whether a refused, unexchanged public token still uses a Trial slot. The Banks panel lists the connected banks before Link opens, which also helps avoid duplicates.

## Part 2 decisions

### Evals run on the fixture data, not Sandbox

- `tests/helpers/fixtures.ts` already has hand-checked totals, and "today" is fixed (2026-09-30), so "last month" always means August 2026.
- Sandbox data changes over time and repeats across banks ([milestone-3.md](milestone-3.md), "Found while testing"), so an expected answer wouldn't stay true.
- Each run seeds a fresh in-memory database (PGlite), the same way the tests do. Nothing touches the dev database.
- New cases that need new data extend the fixtures, and their hand-checked totals are updated in the same change.

### What the cases cover

About 25 cases, each a question (or a short conversation) with expectations:

| Area                            | Example                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Spending by category and period | "What did I spend the most on last month?"                                                        |
| Comparisons                     | "Did I spend more in September than August?"                                                      |
| Merchants and search            | "How much have I spent at Amazon?" (one refund nets against it)                                   |
| What doesn't count              | Transfers, card payments and card autopays excluded; pending excluded unless asked                |
| Subscriptions                   | Netflix and Spotify monthly; Adobe only with a longer lookback                                    |
| Balances                        | Cash, card debt, net worth estimate                                                               |
| No data                         | A month before the data starts: say so rather than estimate                                       |
| Follow-ups                      | "And the month before?" uses the conversation                                                     |
| Boundaries                      | Investment advice is declined; a merchant name that tries to give instructions is treated as data |
| Tool use                        | Fixture questions don't call `sync_now`                                                           |
| The M2 bug                      | A charge and its refund cancel out; Claude doesn't claim the summary missed spending              |

### Grading: deterministic first

Each case lists checks, all of which must pass:

- **Numbers:** expected amounts appear in the answer, in any common format ("$1,778.98" or "1778.98"), within a cent.
- **Tools:** tools that must be called and tools that must not.
- **Wording:** patterns that must appear ("doesn't cover") or must not ("you should invest").

A model-judged check (Claude grading the answer against a rubric) would catch more, but it's slower, costs more and can itself be wrong. It's out of scope to start. If added later, it's a separate score, not part of the pass rate.

### The eval runner

- `npm run eval`, with flags: `--model`, `--effort`, `--case <id>` (run one), `--repeat <n>` (see how consistent a case is).
- Uses the real Claude API through the same `runAgent` loop as the app. A full run costs real tokens, so it's never part of `npm test`.
- Prints a table (case, pass or fail, failed checks, tokens, seconds, tool calls) and the pass rate.
- Saves the full report, answers included, to `evals/results/` (gitignored). That's safe because the data is fixtures.
- Token totals per run. A dollar estimate uses a price table filled in from Anthropic's pricing page.
- The same set can run against other Claude models and effort levels to compare them.

### The M2 refund bug

In Sandbox, a $500 airline charge and its $500 refund net Travel to $0, so `spending_by_category` hides the category. A later search showed the charge without the refund, and Claude concluded the summary had missed $500. Fix: categories whose refunds cancel out are still listed, with their gross spent and refunded amounts.

## Out of scope

- Real accounts (M5)
- Dashboards for the logs; `jq` over the JSON lines is enough for now
- Model-judged grading, to start
- Non-Claude models ([plan.md](plan.md), ideas for later)
