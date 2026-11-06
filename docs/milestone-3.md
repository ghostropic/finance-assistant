# Milestone 3: Connecting banks

**Goal:** Banks are connected, synced, repaired and removed from the app, without scripts. Claude can bring the data up to date when a question needs it.

**Done when:** at `http://127.0.0.1:3000`, a Sandbox bank can be connected through Plaid Link and its transactions appear. The Sync button and a question like "sync my accounts, then tell me what I spent this week" both pull new data. A broken connection shows "Reconnect" and can be repaired, and removing a bank deletes it at Plaid and locally.

## Status (2026-10-21)

**Done.** Checked in the browser against Plaid Sandbox and the real Claude API:

- The page synced on open when the data was more than 12 hours old, and the Sync button synced again.
- Tartan Bank was connected through Plaid Link: 5 accounts, with its first sync in the same request. A progress banner shows while that runs, then the result.
- Connecting Tartan Bank a second time was refused, and only one Tartan Bank exists in the database.
- After `/sandbox/item/reset_login`, Sync marked Tartan Bank "Needs reconnecting" while the other banks synced. The header showed "1 bank to reconnect", and Reconnect (Link update mode) fixed it.
- "Sync my accounts, then tell me what I spent this week" called `sync_now` first. It reported "already up to date" (synced under 5 minutes earlier) and that Tartan Bank needed reconnecting, and Claude passed that on.
- Remove asked for confirmation, then deleted a duplicate First Platypus Bank at Plaid and locally.
- 99 tests pass, along with lint, typecheck and a production build.

**Found while testing:**

1. **Link can't open from inside a modal.** React Aria makes everything outside an open modal inert, Link's iframe included. The Link flow lives at the app level (`use-banks.ts`) and closes the Banks panel when Link opens, since unmounting `usePlaidLink` would close Link.
2. **Plaid's script loaded twice in development.** React's development double-mount made `react-plaid-link` add its script tag twice. The root layout now loads it once (`beforeInteractive`), and the hook reuses that tag.
3. **Sandbox gives every bank the same fake transactions.** With two First Platypus banks and Tartan Bank connected, every charge appeared two or three times, and Claude correctly flagged them as likely duplicates. M4's evals should use a single Sandbox bank or the fixture data.
4. **Banks connected before this milestone have no `institution_id`,** so the duplicate check can't catch a second connection to them. It works for every bank connected through Link.
5. **Sandbox quirks for Link:** picking a big bank opens a "First Platypus OAuth" test screen. Search for a non-OAuth test bank (Tartan Bank, Houndstooth Bank) instead. Any verification code is `1234`.

## Deliverables

1. Plaid Link in the UI: link token, Link, public token exchange, first sync
2. A Banks panel: each connected bank with its accounts, last sync and status, plus Connect, Sync, Reconnect and Remove
3. `POST /api/sync`, shared by the Sync button and the tool, one sync at a time
4. A `sync_now` tool for Claude, with limits
5. Connection health: Plaid errors saved per bank, and Link update mode to repair them
6. Removing a bank: `/item/remove`, then delete its rows
7. One Plaid environment per database: each bank records its environment, and a mismatch with `PLAID_ENV` is refused
8. Decision record 0013 (sync from chat) and tests for every route and the tool

## Decisions

### Plaid Link through `react-plaid-link`

- Plaid's official React wrapper. Link loads from Plaid's CDN, which Plaid requires (Link can't be bundled). This is the app's only third-party script. The root layout loads it once; see "Found while testing".
- One Link flow for the whole page (`use-plaid-link-flow.ts`, used by `use-banks.ts`), for both connecting and reconnecting. The buttons only start it.
- **Link token** (`POST /api/plaid/link-token`): `products: [Products.Transactions]` only, a fixed `client_user_id` (single user), US and English, and `transactions.days_requested: 730`. Plaid's default is 90 days of history, and the maximum is 730.
- **Exchange** (`POST /api/plaid/exchange`): the browser sends only the `public_token`. The server exchanges it, looks up the institution itself (`/item/get`) rather than trusting the browser, encrypts and stores the access token, and runs the first sync, retrying while Plaid prepares data, as `plaid:sandbox` does.
- **Duplicates:** a new column stores `institution_id`. Connecting an institution that's already connected is refused with a message, and the new Item is removed at Plaid so it isn't billed. Plaid recommends preventing duplicate Items.
- The access token never reaches the browser. Both routes call `rejectNonLocal` like every other route.

### No webhooks

Plaid would push "new transactions" webhooks, but receiving them needs a public URL, which breaks the local-only rule ([0007](decisions/0007-local-single-user-read-only.md)). Instead, data is synced:

- with the **Sync button**
- by **Claude, through `sync_now`**
- **when the page opens**, if the last sync is more than 12 hours old

### `sync_now`: the chat path may call Plaid, through sync only

[0003](decisions/0003-sync-to-local-db.md) keeps Plaid out of the chat path. `sync_now` is the one exception, and record 0013 will cover it:

- It runs the same sync as the button, under the same lock. If a sync is already running, it waits for that one instead of starting another.
- **Throttled:** if the last sync finished under 5 minutes ago, it returns "already up to date" with the time and doesn't call Plaid.
- **Returns counts only:** per bank, added, updated and removed counts, plus status ("needs reconnecting"). No transaction details. The tools that query the database read the new data afterwards.
- **Its own timeout of 60 seconds.** Other tools keep 15 seconds.
- **The description tells Claude when to use it:** when the user asks for fresh data, or when the question is about the last day or two and the data is older than that. Not before every answer.
- `sync_now` fetches what Plaid already has. Plaid refreshes from the bank on its own schedule (a few times a day). Forcing a bank refresh (`/transactions/refresh`) is a paid add-on and out of scope.

### Connection health and update mode

- New columns on `plaid_items`: `status` (`ok` or `needs_reconnect`) and `last_error_code` (the Plaid error code only, never the message, which can contain account details).
- Sync records `ITEM_LOGIN_REQUIRED` and similar errors on that bank and carries on with the others, so one broken bank doesn't stop the rest.
- **Reconnect** opens Link in update mode: a link token created with the Item's access token, on the server. Success clears the status and runs a sync.
- Tested in Sandbox with `/sandbox/item/reset_login`, which forces `ITEM_LOGIN_REQUIRED`.

### Removing a bank

`DELETE /api/banks/[id]` calls `/item/remove` first, then deletes the Item. Accounts and transactions cascade. If Plaid says the Item no longer exists, the local rows are still deleted. The UI asks for confirmation first, naming the bank and how many transactions will be deleted.

### One Plaid environment per database

Sandbox and real data never share a database. M4's evals and later development keep using Sandbox data, so real accounts get their own database instead of replacing it (steps in [plan.md](plan.md#switching-to-real-data-m5)). M3 adds the check that stops the two from mixing:

- **A new `environment` column on `plaid_items`** (`sandbox` or `production`), set from `PLAID_ENV` when a bank is connected. The migration fills it with `sandbox` for existing rows, which all are.
- **A mismatch is refused.** If any bank in the database has a different environment from `PLAID_ENV`, connecting, syncing and the scripts stop with a message naming both. The server checks at startup too. Without this check, pointing production keys at the Sandbox database would mix fake and real transactions in every total, and syncing would fail on the Sandbox banks with confusing Plaid errors.
- **Environment isolation relies on this.** `PLAID_ENV` must match what's in the database so Sandbox and Production data never mix.

### UI

- **Header:** a Sync button next to the last-synced time, with a spinner while it runs. "N banks to reconnect" appears when any bank needs it, and opens the Banks panel.
- **Banks panel:** a HeroUI `Drawer` opened from the header. It closes when Plaid Link opens. It lists each bank with its accounts (name, last four digits, type), last sync and status, with Sync, Reconnect and Remove actions, and a "Connect a bank" button.
- **Empty state:** with no banks, the chat's empty state offers "Connect a bank" instead of example questions.
- After a sync, from the button or `sync_now`, the header and panel refresh. Results appear as a banner: a spinner while connecting, then green, yellow (a bank needs attention) or red.

## Verification

- **Tests** (PGlite, with a fake Plaid client) cover the link-token request (only `transactions`, 730 days), the exchange (encrypted storage, duplicate refusal), the sync lock and throttle, error recording, removal, the environment check, and that `sync_now` returns no transaction details.
- **In the browser** against Sandbox: connect, sync, `sync_now` through a question, reset login, reconnect, remove.
- **One manual step:** the Plaid Link window is a Plaid page, not this app. Sign in there with Sandbox credentials (`user_good` / `pass_good`); the app validates the resulting connection afterward.
- **Testing the app's side of Link without Plaid:** in the browser console, replace `window.Plaid.create` with a stand-in that calls `onLoad`, then `onSuccess` with a fake public token. The exchange fails with `INVALID_PUBLIC_TOKEN`, which exercises the error path without connecting anything.

## Files

| File                                                           | What it does                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `prisma/migrations/…`                                          | `environment`, `institution_id`, `status`, `last_error_code` on `plaid_items` |
| `src/lib/environment.ts`                                       | The environment check, used by the server, the scripts, sync and connect      |
| `src/instrumentation.ts`                                       | Runs the environment check when the server starts                             |
| `src/sync/sync.ts`                                             | Records per-bank errors; `syncAll` carries on past a failed bank              |
| `src/sync/runner.ts`                                           | The single sync lock and throttle, shared by the route and the tool           |
| `src/server/banks.ts`                                          | Link token, exchange, update mode and removal, around the Plaid client        |
| `src/server/clients.ts`                                        | One Anthropic client, Plaid client and sync runner per server process         |
| `src/server/errors.ts`                                         | Turns bank-route errors into JSON responses; Plaid errors by code only        |
| `src/server/startup.ts`                                        | The startup environment check                                                 |
| `src/app/api/plaid/link-token/route.ts`, `…/exchange/route.ts` | Link endpoints                                                                |
| `src/app/api/sync/route.ts`                                    | `POST /api/sync`                                                              |
| `src/app/api/banks/route.ts`, `…/[id]/route.ts`                | List banks, remove a bank                                                     |
| `src/tools/sync-now.ts`, `index.ts`, `definitions.ts`          | The `sync_now` tool; per-tool timeouts                                        |
| `src/app/layout.tsx`                                           | Loads Plaid's Link script once                                                |
| `src/app/chat/hooks/use-banks.ts`, `use-plaid-link-flow.ts`    | Banks, syncing and the single Link flow                                       |
| `src/app/chat/components/banks-drawer/`                        | The Banks panel, bank cards and the Remove confirmation                       |
| `src/app/chat/components/header-actions/`, `notice-banner/`    | Sync and Banks buttons; result banners                                        |

## Out of scope

- Webhooks, and forcing a bank refresh with `/transactions/refresh`
- Real accounts and Plaid production access (M5). Most large banks use OAuth; on desktop web, Link opens the bank's sign-in in a pop-up, so the localhost app needs no redirect URI (Plaid's OAuth docs).
- Still open from M2: show categories whose refunds cancel out, and save token usage
