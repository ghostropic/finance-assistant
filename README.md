# Finance Assistant

A personal finance chat assistant. You ask questions about your money in plain English ("What did I spend the most on last month?"), and Claude answers by calling tools that query your own transaction data.

> [!WARNING]
> This is an unauthenticated, single-user application intended to run only on your own computer. Do not deploy it or expose it to a network without first adding authentication, authorization and per-user data isolation.

Bank data comes from [Plaid](https://plaid.com) and is synced into a local Postgres database. Claude never talks to Plaid directly. It calls a small set of read-only tools over the local database, then answers from the results.

This is a single-user practice project that runs locally. It's built to learn tool use, agent loops, streaming and evals with the Claude API.

## Status

**Milestones 1 and 2 are done:** Plaid Sandbox sync, five tools, the agent loop, a terminal chat, and a web chat that streams answers and saves conversations. See [docs/milestone-2.md](docs/milestone-2.md) for the latest, and [docs/plan.md](docs/plan.md) for what's next (Milestone 3: connecting banks with Plaid Link).

## Stack

- **App:** Next.js (App Router) with React and TypeScript
- **UI:** Tailwind CSS v4 and HeroUI v3
- **Database:** Postgres 17 (Docker), accessed with Prisma 7
- **LLM:** Claude API through the Anthropic TypeScript SDK
- **Bank data:** Plaid (Sandbox while developing)

## Running it

### Prerequisites

- Node.js 24 or newer
- Docker Desktop (or any local Postgres 17)
- A [Plaid](https://dashboard.plaid.com) account with **Sandbox** keys
- An [Anthropic API key](https://console.anthropic.com)

### First-time setup

1. Install dependencies (this also generates the Prisma client):

   ```bash
   npm install
   ```

2. Create `.env` from the example, then fill in `ANTHROPIC_API_KEY`, `PLAID_CLIENT_ID` and `PLAID_SECRET`:

   ```bash
   cp .env.example .env
   ```

3. Generate an encryption key for Plaid access tokens and paste it into `.env` as `TOKEN_ENCRYPTION_KEY`:

   ```bash
   openssl rand -base64 32
   ```

4. Start Postgres and create the tables:

   ```bash
   npm run db:up
   ```

   ```bash
   npm run db:migrate
   ```

   Run `npm run db:migrate` again whenever you pull changes that add migrations. It also regenerates the Prisma client.

5. Start the app (see below) and click **Connect a bank**. In Sandbox, pick any bank and sign in with `user_good` / `pass_good`.

   Or connect Plaid's default Sandbox bank from the terminal:

   ```bash
   npm run plaid:sandbox
   ```

### Everyday use

Start the web chat, then open http://127.0.0.1:3000:

```bash
npm run dev
```

It only listens on this machine, so other devices on your network can't reach it.

**Banks** in the header lists connected banks, with Connect, Reconnect and Remove. **Sync** pulls new transactions and balances. The page also syncs when it opens if the data is more than 12 hours old, and Claude can sync when you ask for up-to-date data.

Or ask questions in the terminal (`/reset` starts over, `/exit` quits, Ctrl+C stops an answer):

```bash
npm run chat
```

The app writes structured logs (counts, timings, token usage and error codes, never transaction data) to `logs/app.jsonl`. For example, the last ten chat turns:

```bash
grep '"chat_turn"' logs/app.jsonl | tail -n 10
```

Pull new transactions and balances from the terminal:

```bash
npm run sync
```

Resync every bank's whole history, for example after a sync bug. It's safe to repeat, and transactions Plaid no longer has are removed once its history is complete:

```bash
npm run sync -- --full
```

### Tests

The tests run on an in-memory Postgres, so they don't need Docker or `.env`:

```bash
npm test
```

### Formatting and lint

Prettier formats the code and docs. Format everything:

```bash
npm run format
```

Check formatting, lint and types without changing anything:

```bash
npm run format:check && npm run lint && npm run typecheck
```

### Troubleshooting

- **"Can't reach the database":** Docker Desktop isn't running, or Postgres hasn't started yet. Open Docker Desktop, then run `npm run db:up`.
- **"PLAID_ENV is … but this database holds banks connected in …":** `PLAID_ENV` and `DATABASE_URL` point at different environments. Sandbox and real data each have their own database; change both together (see [docs/plan.md](docs/plan.md#switching-to-real-data-m5)). The server won't start until they match.
- **"Cannot read properties of undefined" after pulling or migrating:** the running dev server keeps its database client and sync runner between hot reloads. Restart `npm run dev` after `npm run db:migrate`.
- **A bank shows "Needs reconnecting":** the bank wants you to sign in again. Open **Banks** and click **Reconnect**.
- **"configuration is missing or invalid":** a value in `.env` is empty. The message names it.
- **"Connection url is empty" from Prisma:** `DATABASE_URL` is missing from `.env`. Copy that line from `.env.example`.
- **The Sandbox setup says transactions aren't ready:** wait a minute, then run `npm run sync`.

## Docs

- [Plan](docs/plan.md): goals, architecture, milestones and the reasoning behind them
- [Milestone 1](docs/milestone-1.md): data and agent core, with no UI
- [Milestone 2](docs/milestone-2.md): web chat with streaming and saved conversations
- [Security and privacy](docs/security.md): how secrets and financial data are handled
- [Decision records](docs/decisions/): one short file per decision
- [Code style guide](docs/code-style.md): React and TypeScript conventions
