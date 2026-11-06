# 0015: Prettier for formatting

- **Status:** Accepted
- **Date:** 2026-10-26
- **Amends:** the JSX prop layout rules in [0011](0011-tailwind-and-heroui.md) and the style guide

## Context

Layout was partly enforced by ESLint's React rules (prop layout) and otherwise left to hand formatting, so line width and wrapping varied from file to file. Editors that format on save with Prettier reformatted whole files against the ESLint rules.

## Decision

- **Prettier formats everything it supports**, using its defaults except for `semi: false`. `npm run format` rewrites, and `npm run format:check` reports files that differ.
- **Optional semicolons are omitted.** Prettier retains the rare semicolons required to avoid ambiguous JavaScript or TypeScript syntax.
- **ESLint stops checking layout.** The three JSX layout rules are removed and `eslint-config-prettier` is applied last, turning off any rule from the shared configs that would fight Prettier.
- **ESLint still checks what Prettier doesn't:** arrow-function components, JSX depth, import order and Tailwind classes.
- `.prettierignore` adds the lockfile and Prisma migrations; Prettier also skips everything in `.gitignore`.

## Why

- One tool owns layout, so editor format-on-save, `npm run format` and lint all agree.
- No layout decisions in review or by hand.

## Alternatives considered

- **ESLint only, with `@stylistic/eslint-plugin` for whitespace:** keeps the old prop layout rule, but editors' default formatter is Prettier, and formatting through lint is slower and less complete.
- **Prettier with `singleAttributePerLine`:** puts every prop on its own line whenever an element has two or more, close to the old rule. Not chosen for now; it's a one-line change if wanted.
- **`prettier-plugin-tailwindcss`:** would duplicate the class sorting `eslint-plugin-better-tailwindcss` already does, and the two could disagree on order.

## Consequences

- The switch was one repo-wide reformat.
- JSX props now go on one line when they fit in 80 columns.
- Markdown docs are formatted too: tables are padded to align.
