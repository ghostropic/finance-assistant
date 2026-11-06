# Milestone 2: Web chat

**Goal:** The same questions that work in the terminal work in the browser, with answers streaming in as they're written and each tool call shown as it happens.

**Done when:** at `http://127.0.0.1:3000`, "What did I spend the most on last month?" streams an answer with its tool calls visible. Reloading the page keeps the conversation, and a follow-up question ("and the month before?") uses it.

## Status (2026-10-08)

**Done.** Checked in the browser against the real Claude API and Sandbox data:

- "What did I spend the most on last month?" streamed an answer with its tool chip and a rendered table.
- The follow-up "And the month before?" used the conversation (Claude understood it as August).
- Reloading the page brought the whole conversation back.
- Stop ended the answer, the page said it wasn't saved, and the database confirmed nothing from that turn was stored.
- The guard returned 403 for another website's Origin and for a spoofed Host, and the server isn't reachable from the LAN address.
- 49 tests pass (17 new), along with lint, typecheck and build.

**Found while testing (not M2 bugs, follow-ups below):**

1. **Claude "corrected" a right answer.** The Sandbox data has a $500 United Airlines charge on the card and a $500 refund on checking each month, so Travel nets to $0 and `spending_by_category` hides it. A later search showed the charge without the refund, and Claude concluded the summary had missed $500. The tool should show categories whose refunds cancel out, with their gross spent and refunded amounts, so this can't be misread.
2. **Token usage isn't saved,** so it disappears when the page reloads. That fits with cost tracking in M4.

## Deliverables

1. Conversations stored in Postgres (two new tables)
2. `POST /api/chat`: runs the agent loop and streams its events as SSE
3. `GET /api/conversations`, `GET /api/conversations/[id]` and `GET /api/status`
4. A React chat page: conversation list, streamed markdown answers, tool-call chips, a stop button and token usage
5. Tests for the SSE format, conversation storage and the request guard

## Decisions

### Conversations are stored on the server

The browser sends only the new question and a conversation ID. The server loads the history from Postgres, runs the loop and saves the new messages.

- **Why not keep history in the browser?** Claude Opus 5.5 requires earlier turns, including its thinking blocks, to be sent back exactly as they were. If the server owns the history, the browser can't edit it, and reloading the page doesn't lose it.
- **Tables:**
  - `conversations` (`id`, `title`, timestamps)
  - `conversation_messages` (`conversation_id`, `seq`, `role`, `content` as JSON)

  `content` is the exact Anthropic message, so it can be sent back unchanged.

- **Title:** the first question, cut to 60 characters.
- **A turn is saved only if it finishes with Claude's answer.** If it fails, is stopped, or ends partway (round limit, refusal), nothing from that turn is saved, so stored history always ends on a complete exchange.
- **Append-only:** turns are added, never edited, which is what the API needs for thinking blocks to stay valid.

### SSE over a POST (see [0006](decisions/0006-sse-over-fetch.md))

- `POST /api/chat` with `{ conversationId?, message }` returns `text/event-stream`.
- **Events:**
  - `conversation` (the ID and title, sent first, so a new chat gets its ID immediately)
  - then the loop's own events: `text`, `tool_start`, `tool_result`, `notice` and `done`
  - `error` if something fails
- The browser reads the stream with `fetch` and a small parser that handles events split across network chunks.
- **Stop:** the browser aborts the fetch, and the server passes the request's abort signal into the loop, which stops the Claude call.
- **One turn per conversation at a time.** A second request while one is running gets `409`.

### Reloading a conversation

Stored messages are converted back into what the page shows: questions, answer text and tool chips, with each result summarized as it was while streaming. Live streaming and reloaded history use the same display types, so they look the same.

### Local only (see [0007](decisions/0007-local-single-user-read-only.md) and [security.md](security.md))

- **`next dev` and `next start` are bound to `127.0.0.1`.** Next.js listens on every network interface by default, which would expose your finances to your Wi-Fi network.
- **Every API route checks the request is local.** The `Host` header must be `localhost`, `127.0.0.1` or `[::1]`, and an `Origin` header, if present, must match it. Anything else gets `403`. This blocks other websites open in your browser (and DNS-rebinding tricks) from calling the API and spending your Claude credits.
- **Keys stay on the server.** The browser never sees the Anthropic or Plaid keys.

### UI

- One page. On the left, a sidebar with "New chat" and past conversations. On the right, the chat.
- **Answers** render as markdown (tables included) with `react-markdown` and `remark-gfm`. Raw HTML in model output is not rendered.
- **Tool calls** appear as small chips in the answer ("Spending by category · 4 categories, $1778.98 spent"), and can be expanded to show the exact input.
- **The header** shows the model, the transaction count and when the data was last synced.
- **Under each answer:** token usage (total input with the cached share, and output).
- **Composer:** Enter sends, Shift+Enter adds a line, and a Stop button appears while an answer is streaming.
- Plain CSS modules, with light and dark mode following the system setting. No UI framework.

### Reuse

- The loop (`src/agent/loop.ts`) is unchanged. A new `src/server/chat.ts` wraps it with loading and saving, and both the route and the tests use it.
- The terminal chat stays as it is, with history in memory.

## Files

| File                          | What it does                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/server/chat.ts`          | `runChatTurn()`: loads a conversation, runs the loop, saves a completed turn                                                |
| `src/server/local-only.ts`    | The Host/Origin guard used by every API route                                                                               |
| `src/chat/sse.ts`             | SSE encoder and incremental parser (shared by server and browser)                                                           |
| `src/chat/display.ts`         | Display model: `applyEvent()` for live streaming, `mapMessagesToTurns()` for reloads                                        |
| `src/app/api/chat/route.ts`   | `POST /api/chat`                                                                                                            |
| `src/app/api/conversations/…` | Conversation list, one conversation, deleting one                                                                           |
| `src/app/api/status/route.ts` | Model, data counts, last sync                                                                                               |
| `src/app/chat/`               | The chat feature (layout per the [style guide](code-style.md)): `ChatApp.tsx`, `hooks/use-chat.ts`, `api.ts`, `components/` |

## Out of scope

- Plaid Link, a sync button and a `sync_now` tool (M3)
- Renaming conversations. Deleting them was added on 2026-11-02: `DELETE /api/conversations/[id]`, and a trash button on each conversation in the list, which asks for confirmation.
- Evals, cost tracking and structured logging (M4)
