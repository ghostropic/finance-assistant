# 0005: Hand-written tool loop with the Anthropic SDK

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Tool use needs a loop: call Claude, run the tools it asks for, send back the results, repeat. Libraries such as the SDK's tool runner or the Vercel AI SDK can do this for us.

## Decision

Write the loop ourselves on top of the Anthropic TypeScript SDK's streaming API, as an async generator that yields events (`text`, `tool_start`, `tool_result`, `done`).

## Why

- Learning how the messages array, `tool_use` blocks and `tool_result` blocks fit together is a main goal of the project.
- Full control over limits, error handling, logging and what is streamed to the UI.
- One event stream serves the terminal (M1) and SSE (M2) without changing the loop.

## Alternatives considered

- **SDK tool runner:** Less code. Worth trying later to compare.
- **Vercel AI SDK:** Excellent React integration, but hides the loop and adds a provider abstraction we don't need.

## Consequences

- We own edge cases: several tool calls in one turn, tool errors, hitting `max_tokens` and limiting the number of rounds.
