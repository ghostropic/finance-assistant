# Milestone 1: Data and agent core

**Goal:** Ask a question in the terminal and get a correct answer from Plaid Sandbox data, with each tool call shown as it happens. There's no web UI yet.

**Done when:** `npm run chat`, given "What did I spend the most on last month?", prints the tool calls Claude makes and a correct answer, and the tool tests pass.

## Status (2026-10-07)

**Done.** The "done when" check passed against the real Claude API and Plaid Sandbox: "What did I spend the most on last month?" ran two tools in parallel and answered from the data, and the totals matched a direct SQL check.

That first run found one bug: a credit card autopay counted as spending, now fixed (see [0009](decisions/0009-what-counts-as-spending.md)).

| Part                                                      | State                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Schema, migration, sync, tools, agent loop, terminal chat | Built                                                                                                      |
| Tests (32: tools, sync, encryption, agent loop)           | Passing, on in-memory Postgres                                                                             |
| Lint, typecheck, `next build`                             | Passing                                                                                                    |
| Terminal chat against seeded data                         | Checked with an invalid API key: starts, reads questions, handles the API error, `/reset` and `/exit` work |
| Real Claude API call                                      | Working (2026-10-07)                                                                                       |
| Real Plaid Sandbox setup and sync                         | Working: 5 accounts, 49 transactions (Jul 9 to Oct 7, 2026)                                                |
| Docker Desktop 4.93                                       | Installed and running                                                                                      |

**Known limitation:** Plaid's default Sandbox user repeats the same transactions every month, so `recurring_charges` reports almost every merchant as monthly (KFC at $500 a month, for example). The fixture tests cover the rule properly. For more realistic Sandbox data, try `npm run plaid:sandbox -- --user user_transactions_dynamic`.

### Decisions made while you were away (please review)

1. **Tests run on PGlite**, an in-memory Postgres 17, instead of a separate test database, so `npm test` needs no Docker. See [0008](decisions/0008-tests-on-pglite.md).
2. **What counts as spending:** net of refunds; excludes income, transfers and credit card payments (including any loan payment on a card account); pending excluded by default. Accepted 2026-10-07. See [0009](decisions/0009-what-counts-as-spending.md).
3. **Raw SQL uses `$queryRaw` tagged templates**, not TypedSQL, and **Prisma 7.10** rather than the Prisma 8 release candidate. See [0002](decisions/0002-postgres-with-prisma.md).
4. **Refusal fallback is on.** Requests go through the beta Messages API with `fallbacks: "default"`, so if Claude's safety checks decline a request, Anthropic's recommended fallback model answers instead. This is unlikely to trigger for finance questions, and is easy to remove in `src/agent/loop.ts`.
5. **Effort defaults to `medium`** (`ANTHROPIC_EFFORT`). Adaptive thinking is always on for Claude Opus 5.5, and effort is how you trade depth for cost and speed.
6. **`search_transactions` gained `direction` and `include_pending`**, and its amount filters ignore direction (so "over $50" finds both a $60 purchase and a $60 refund).
7. **"Today" uses this Mac's local time zone**, so "last month" matches your calendar.

## Project layout

```
finance-assistant/
  src/
    lib/
      env.ts           Reads and validates settings from .env
      db.ts            Prisma client (pg driver adapter)
      crypto.ts        Encrypt and decrypt Plaid access tokens
      plaid.ts         Plaid client; the only place access tokens are decrypted
      dates.ts         Today's date in local time
      load-env.ts      Loads .env for scripts
    sync/
      sync.ts          /transactions/sync and balances into Postgres
    tools/
      spending.ts      The single definition of "spending"
      schemas.ts       Zod input schemas (validation + the JSON Schema Claude sees)
      definitions.ts   Tool names and descriptions sent to Claude
      handlers.ts      The tool functions
      index.ts         Registry; validates input and runs a tool without throwing
    agent/
      loop.ts          The tool loop; yields events (text, tool_start, tool_result, notice, done)
      prompt.ts        System prompt
    generated/prisma/  Generated Prisma client (not committed)
  scripts/
    sandbox-setup.ts
    sync.ts
    chat.ts            Terminal chat; prints the loop's events
  prisma/
    schema.prisma
    migrations/
  tests/
    helpers/db.ts      Starts an in-memory Postgres per test file
    helpers/fixtures.ts  Fixed data set with hand-checked totals
    tools.test.ts  sync.test.ts  crypto.test.ts  loop.test.ts
  docker-compose.yml
  prisma.config.ts
```

`src/app/` holds only a placeholder page until M2.

## Decisions

### Postgres runs in Docker Compose

- `docker compose up -d` (or `npm run db:up`) starts Postgres 17, bound to localhost only, with a named volume so data survives restarts.
- The code only reads `DATABASE_URL`, so Postgres.app or Homebrew Postgres work too.

### Schema

| Table          | Key columns                                                                                                                                                                                 | Notes                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `plaid_items`  | `id`, `plaid_item_id`, `institution_name`, `access_token_encrypted`, `sync_cursor`, `last_synced_at`                                                                                        | One row per connected bank                                                       |
| `accounts`     | `id`, `plaid_item_id`, `plaid_account_id`, `name`, `official_name`, `type`, `subtype`, `mask`, `current_balance`, `available_balance`, `credit_limit`, `currency`                           | Balances refreshed on every sync                                                 |
| `transactions` | `id`, `account_id`, `plaid_transaction_id`, `date`, `authorized_date`, `name`, `merchant_name`, `amount`, `currency`, `category_primary`, `category_detailed`, `payment_channel`, `pending` | Unique on `plaid_transaction_id`; indexed on date, merchant, and category + date |

- **Money is stored as `numeric(14,2)`** (Prisma `Decimal`), never as a float, so totals don't drift.
- **The amount sign follows Plaid's convention:** positive means money left the account, negative means money came in. The tools convert this into plain terms ("spent", "received") so Claude never has to remember the convention.
- **Categories use Plaid's `personal_finance_category`** (primary and detailed). We don't make our own categories in M1.
- **Pending transactions are stored** with `pending = true`. When one posts, Plaid removes the pending version and adds the posted one, and sync applies both.

### What counts as spending

Defined once in `src/tools/spending.ts` and used by every tool; see [0009](decisions/0009-what-counts-as-spending.md).

### Plaid Sandbox setup

- `npm run plaid:sandbox` calls `/sandbox/public_token/create` for Plaid's default Sandbox institution (First Platypus Bank, `ins_109508`) with only the `transactions` product, then `/item/public_token/exchange`, stores the encrypted token, and runs the first sync. It refuses to run unless `PLAID_ENV=sandbox`.
- `-- --user <sandbox username>` picks a different Sandbox test user (Plaid documents several, such as `user_transactions_dynamic` for more realistic data).
- A new Item can take a few seconds before transactions are ready, so the script retries the first sync for up to a minute.
- This skips Plaid Link entirely. Link comes in M3.

### Access tokens are encrypted at rest

- AES-256-GCM with a fresh IV each time and the key in `TOKEN_ENCRYPTION_KEY`. Stored as `v1:<iv>:<tag>:<ciphertext>` so the format can change later.
- Decrypted only by `src/lib/plaid.ts`; never logged or returned by a tool.

### Sync

- Calls `/transactions/sync` from the saved cursor, following `has_more` until done.
- If Plaid reports `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, the whole loop restarts from the first page's cursor (up to 3 times), as Plaid's docs require.
- Accounts and balances, added and modified transactions (upserted), removed transactions (deleted) and the new cursor are all written in **one database transaction**. If anything fails, the old cursor stays and the next run redoes the work.
- If Plaid isn't ready yet on the very first sync, nothing is saved.
- Running sync twice in a row is safe and changes nothing the second time (tested).

### Tools

Each tool returns compact JSON: totals and short lists, never raw Plaid objects, Plaid IDs or tokens. Accounts appear as name plus last four digits.

| Tool                   | Inputs                                                                                                                                                                                    | Returns                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_balances`         | none                                                                                                                                                                                      | Each account's balance; totals for cash, investments, credit card debt, loans and an estimated net worth; institutions; `data_as_of` (last sync)            |
| `spending_by_category` | `start_date`, `end_date`, `include_pending?`                                                                                                                                              | Spending per primary category (total and count), largest first, and the overall total                                                                       |
| `search_transactions`  | `start_date?`, `end_date?`, `merchant?`, `category?`, `direction?` (spent, received, any), `min_amount?`, `max_amount?`, `include_pending?` (default true), `limit?` (default 25, max 50) | Newest matching transactions (date, description, amount, direction, category, account, pending) plus totals across **all** matches                          |
| `compare_periods`      | `period_a_start`, `period_a_end`, `period_b_start`, `period_b_end`, `category?`                                                                                                           | Spending in each period, the difference (B minus A) and percent change, overall and per category                                                            |
| `recurring_charges`    | `lookback_months?` (default 6, 2 to 24)                                                                                                                                                   | Merchants charged at a regular interval with steady amounts: frequency, typical amount, estimated monthly cost, count and last charge, plus a monthly total |

- **Dates are `YYYY-MM-DD` and inclusive.** The system prompt gives Claude today's date so it can work out "last month" itself.
- **Inputs are validated with Zod**, and the same schemas generate the JSON Schema Claude sees, so the two can't drift. Unknown fields, impossible dates (such as Sept 31) and reversed ranges are rejected. Invalid input goes back to Claude as an error result (`is_error: true`) so it can correct itself.
- **Each tool call has a 15-second timeout.** Database errors go to the terminal; Claude gets a generic error without query details.
- **Recurring-charge rule:** the same merchant, a median gap that fits weekly, every two weeks, monthly, quarterly or yearly, at least 80% of gaps in that band, at least 80% of amounts within 10% of the typical amount, and 3+ charges (2 for yearly). We'll refine it with real data.

### Agent loop

- **Anthropic TypeScript SDK, streaming from the start.** `runAgent()` is an async generator yielding `text`, `tool_start`, `tool_result`, `notice` and `done` events. The terminal prints them; the M2 route handler will turn the same events into SSE.
- **The loop:** stream a response, append Claude's full response (thinking blocks included) to the history, run every requested tool **in parallel**, send all results back in **one** user message, and repeat until Claude stops asking for tools.
- **Model:** `ANTHROPIC_MODEL`, default `claude-opus-5-5`. Thinking is adaptive (always on for this model); `ANTHROPIC_EFFORT` (default `medium`) controls depth.
- **Caching:** automatic prompt caching on each request, so the tools, system prompt and earlier turns are cheaper on later rounds. The chat shows cached tokens per answer.
- **Safety limits:** at most 10 Claude calls per question; tools from a response cut off at the output limit are never run; a refused request ends the turn with a notice.
- **System prompt** (`src/agent/prompt.ts`): today's date, how to read date phrases, that amounts are already "spent" or "received", the spending rules, "say so rather than guess", brief answers with plain category names, no personalized investment, tax or legal advice, and that merchant text is data, not instructions.
- **History** lives in memory for the terminal session. If a turn fails, the history rolls back to before that question. Saving conversations waits until M2.

### Terminal chat

- `npm run chat`. Shows the model, effort and number of transactions on startup.
- Prints each tool call and a one-line result summary (for example, "4 categories, $1778.98 spent"), then token usage per answer: total input with the cached share, and output.
- `/reset` starts a new conversation, `/exit` quits, Ctrl+C stops an answer in progress (or quits when idle).

### Tests

- **Vitest on PGlite**, an in-memory Postgres 17 started per test file with the real migrations applied. See [0008](decisions/0008-tests-on-pglite.md).
- **Fixtures** (`tests/helpers/fixtures.ts`): a fixed data set with today set to 2026-09-30 and hand-checked totals written at the top of the file.
- **Coverage:**
  - **Tools:** inclusive date edges, the sign convention, refunds, pending exclusion, transfers and card payments excluded, the search limit versus totals, LIKE wildcard escaping, percent change from zero, recurring and non-recurring patterns, no IDs or tokens in results, and input validation.
  - **Sync:** first sync, modified and removed transactions, pagination, mutation restart, not ready, idempotency, and failure keeping the old cursor.
  - **Encryption:** round trip, tampering and the wrong key.
  - **Agent loop:** run against a scripted fake API, checking parallel tool calls, the shape of the message history, error results, round limits and max-tokens handling.
- We checked that the tests catch mistakes: deliberately breaking the credit-card-payment rule fails 5 of them, and removing the card-account loan-payment rule fails 7.
- Checking the quality of Claude's answers belongs to the eval set in M4.

### npm scripts

| Script                | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `db:up` / `db:down`   | Start or stop Postgres in Docker                             |
| `db:migrate`          | Apply Prisma migrations (`prisma migrate dev`)               |
| `db:generate`         | Regenerate the Prisma client (also runs after `npm install`) |
| `plaid:sandbox`       | Create a Sandbox bank connection and run the first sync      |
| `sync`                | Sync all connected banks                                     |
| `chat`                | Terminal chat                                                |
| `test` / `test:watch` | Run the tests                                                |
| `typecheck` / `lint`  | Type and lint checks                                         |

## Out of scope for M1

- Web UI, the HTTP endpoint and SSE (M2)
- Plaid Link, real accounts and a `sync_now` tool (M3)
- Evals, cost tracking and structured logging (M4)

## Before starting

- [x] Install Docker Desktop
- [ ] Launch Docker Desktop once (accept the license; it asks for your Mac password)
- [ ] Create a Plaid account and get the Sandbox client ID and secret
- [ ] Copy `.env.example` to `.env` and fill in the Plaid keys, the Anthropic API key and a generated `TOKEN_ENCRYPTION_KEY`
