# 0010: Code style guide

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The codebase had grown to about 40 TypeScript files across two milestones with no written conventions. A React and TypeScript style guide from another project was proposed for reuse.

## Decision

Adopt that guide as `docs/code-style.md`, with a "Project adaptations" section for the differences. ESLint enforces the parts that can be checked: arrow-function components (`react/function-component-definition`), JSX depth of 4 (`react/jsx-max-depth`) and import order (`import/order`).

The existing code was refactored to match. The chat page became a feature folder (`src/app/chat/`) with `api.ts`, `types.ts`, `utils.ts`, `constants.ts`, `hooks/use-chat.ts`, and one folder per component with its own stylesheet.

## Adaptations, and why

- **CSS modules, not SCSS:** the project has no Sass. Superseded by [0011](0011-tailwind-and-heroui.md): styling is now Tailwind and HeroUI, with CSS modules only where Tailwind can't reach.
- **No TypeScript `enum`:**
  - Wire and data values use string literal unions, because they cross JSON boundaries (database, SSE, the Claude API), where literal unions type-check end to end.
  - Runtime sets use `as const` arrays or objects.
  - Library constants are used directly (`AccountType` from `plaid`).
- **Short _why_ comments stay:** the original bans inline comments. Here they record security reasons, Plaid quirks and links to decision records, which names can't carry. Comments that restated the code were removed or replaced by better names.
- **Top-level `tests/` for server code:** those tests share the in-memory Postgres helpers.
- **Tool handlers keep their tool's name** (`getBalances` for `get_balances`), so a tool maps directly to its code.
- **Next.js special files** keep the names and exports Next.js requires.

## Alternatives considered

- **Adopt the guide verbatim:** would delete the reasoning behind several security and data-correctness rules, and require enums the code doesn't benefit from.
- **No written guide:** conventions would drift and contributors would have to infer them from existing files.
- **Enforce everything with ESLint:** "no inline handlers" can't be checked without also flagging handlers declared above `return` (`react/jsx-no-bind`), which the guide asks for. Those rules are checked in review instead.

## Consequences

- New code follows the guide, and `npm run lint` catches the checkable parts.
- Some rules (component size, naming, comments) depend on review.
