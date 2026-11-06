# Security and privacy

This app handles real financial data once it reaches M5. These rules apply from the first line of code, so nothing has to be retrofitted later.

## Scope limits

- **Read-only Plaid products.** Only `transactions` (which includes balances) is requested. Never enable Transfer, Payment Initiation, Auth or any product that can move money or expose full account numbers.
- **Plaid Link** is the app's only third-party script. It loads from Plaid's CDN, as Plaid requires. The browser only ever holds link tokens and public tokens; the server exchanges the public token and keeps the access token.
- **Local only.** The app runs on `localhost` and has no login. Don't deploy it anywhere without first adding real authentication.
  - `npm run dev` and `npm start` bind to `127.0.0.1`. Next.js otherwise listens on every network interface, which would expose the app to the local network.
  - Every API route rejects requests whose `Host` isn't `localhost`, `127.0.0.1` or `[::1]`, or whose `Origin` doesn't match (`src/server/local-only.ts`). This stops other websites open in your browser, and DNS-rebinding tricks, from reading your data or spending your Claude credits.
- **Single user.** No data from anyone else is stored.

## Secrets

| Secret                            | Where it lives                                    | Never                                      |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY`               | `.env`                                            | In the browser, in git, in logs            |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | `.env`                                            | In the browser, in git, in logs            |
| Plaid access tokens               | `plaid_items.access_token_encrypted`, AES-256-GCM | Returned by a tool, sent to Claude, logged |
| `TOKEN_ENCRYPTION_KEY`            | `.env`                                            | In the database, in git                    |

- `.env` is in `.gitignore`. `.env.example` lists the variable names with no values.
- Secrets are added to `.env` by hand, not pasted into chats or issues.
- Sandbox and production use different Plaid secrets. `PLAID_ENV` must be `sandbox` or `production` (anything else is rejected at startup), and the Sandbox setup script refuses to run unless it's `sandbox`.

## What is sent to Claude

Tool results are sent to the Claude API as part of the conversation.

- Tools return **only what the question needs**: totals and summaries by default, and individual transactions only from `search_transactions`, capped at 50.
- Tools never return access tokens, Plaid IDs, full account numbers or Item IDs. Accounts are identified by name and the last four digits (`mask`).
- Review Anthropic's API data-retention policy before connecting real accounts, and decide whether you're comfortable with it.

## Logging

- Log events, counts, timings, token usage and error codes.
- **Don't log** transaction details, balances, tool results, full prompts or error messages, in any environment.
- All logging goes through `src/lib/log.ts`, which only accepts typed events whose fields are numbers, IDs, and fixed or strictly patterned values. An event that doesn't fit is dropped ([0014](decisions/0014-structured-logging.md)). `tests/log-privacy.test.ts` checks that a chat turn, a sync and a Plaid error log nothing from the data.
- Logs go to `logs/app.jsonl` (gitignored) and the web server's output.
- The eval set (M4) uses only fixture data, so its saved reports, which do include answers, hold no real data.

## Repository checks

`tests/repository-security.test.ts` scans tracked source, configuration and documentation for disallowed Plaid products, money-moving or account-number endpoints, and credential patterns. It runs with the normal test suite.

## Database

- From M2, `conversation_messages` stores every chat turn as sent to Claude, **including tool results**, so it holds transaction details too. It's covered by the same rules as the rest of the database.

- Postgres listens only on `localhost`.
- Real data lives in its own database, `finance_assistant_production`. Sandbox data stays in `finance_assistant`, and the app refuses to run when `PLAID_ENV` doesn't match the banks in the database (from M3; steps in [plan.md](plan.md#switching-to-real-data-m5)).
- The Docker volume holds real data from M5 onward. Treat backups and exports as sensitive.
- Removing a bank (Banks > Remove) removes its Item from Plaid (`/item/remove`) and deletes its accounts and transactions. Saved conversations aren't deleted, so tool results that used its data stay in them. Deleting a conversation (the trash button in the conversation list) removes its messages, including those tool results, and its saved usage.
