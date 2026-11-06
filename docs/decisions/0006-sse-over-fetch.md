# 0006: SSE events read through `fetch`

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The browser should show the answer as it's generated, plus tool activity ("Looking up spending for September…").

## Decision

`POST /api/chat` returns `text/event-stream`. The browser reads it with `fetch` and the response body's stream reader, and parses events such as `event: text` and `event: tool_start`.

## Why

- The browser's built-in `EventSource` supports only GET requests, but the chat needs to send the conversation in a POST body.
- SSE is plain text over normal HTTP: easy to inspect and debug, and enough for one-way streaming.

## Alternatives considered

- **WebSockets:** Two-way, but more infrastructure than needed when the server only streams back.
- **`EventSource` with a GET request:** Would mean putting the conversation in the URL or storing it server-side first.

## Consequences

- We write a small SSE parser on the client.
- Cancelling a response means aborting the fetch with an `AbortController` and stopping the loop on the server.
