# 0001: Next.js for frontend and backend

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The app needs a Node.js backend (to hold API keys and run the tool loop) and a React/TypeScript frontend.

## Decision

Use Next.js (App Router) for both. The chat endpoint is a route handler running on the Node.js runtime.

## Why

- One project, one dev server, one set of dependencies.
- Route handlers run on the server, so the Anthropic and Plaid keys never reach the browser.
- Route handlers can return a streamed `Response`, which is all SSE needs.

## Alternatives considered

- **NestJS backend + Vite React frontend:** More structure (modules, dependency injection) and a clearer client–server boundary, and worth learning in its own right. Rejected for now because it doubles the setup for a single-user app.
- **Express + Vite:** Lighter than NestJS, but still two apps to run and connect.

## Consequences

- Core logic (sync, tools, agent loop) lives in plain modules under `src/`, not inside Next.js-specific files, so it can be run from scripts and moved to another backend later.
- Long-running chat streams must use the Node.js runtime, not the Edge runtime.
