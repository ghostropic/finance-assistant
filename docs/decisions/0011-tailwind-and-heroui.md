# 0011: Tailwind CSS and HeroUI

- **Status:** Accepted, amended by [0015](0015-prettier.md) (Prettier now owns JSX layout)
- **Date:** 2026-10-08
- **Supersedes:** the "CSS modules" styling choice in [0010](0010-code-style-guide.md)

## Context

The UI was styled with hand-written CSS modules. Colors were tokens, but sizes and spacing were typed by hand in each file, every button was styled separately, and there were no accessible building blocks for menus or drawers. That's why narrow screens had no way to start a new chat.

## Decision

- **Tailwind CSS v4** for styling, with HeroUI's theme colors as the palette.
- **HeroUI v3** (`@heroui/react` and `@heroui/styles`) for components. It's built on React Aria and needs no provider.
- **CSS modules** stay for what Tailwind handles badly. Currently that's one: the markdown answer styles, because react-markdown generates that HTML.
- **Theme:** HeroUI's default theme, with this app's green accent overridden in `src/app/globals.css`.
- **Dark mode:** HeroUI reads its theme from a `class` and `data-theme` on `<html>` instead of the system setting. A small script in the root layout (`src/app/theme-script.ts`, loaded with `next/script` `beforeInteractive`) sets both from `prefers-color-scheme` and keeps them in sync.
- **Lint:** `eslint-plugin-better-tailwindcss` checks class order and catches unknown or conflicting classes. ESLint's React rules enforce the JSX prop layout.

## Why

- One consistent scale for spacing, type and color, instead of hand-picked values.
- Accessible components for free: the narrow-screen conversation `Drawer`, the tool call `Disclosure`, `Alert` and the form controls.
- HeroUI v3 is built for Tailwind v4 (its theme colors are ordinary Tailwind colors like `bg-surface` and `text-muted`), so the two don't fight.

## Alternatives considered

- **shadcn/ui:** components copied into the repo, very popular. HeroUI was preferred for its finished look and because it stays a dependency we update rather than code we maintain.
- **Headless UI, Radix or React Aria directly:** more styling work for the same result.
- **`next-themes` for dark mode:** tried first. It renders an inline `<script>` from a client component, which React 19 warns about in development. A system-only theme needs just a few lines of script, so the dependency wasn't worth it. If a manual light/dark toggle is ever added, revisit this.
- **Prettier with `prettier-plugin-tailwindcss`:** sorts classes well, but Prettier's JSX layout puts props back on one line when they fit, which contradicts the style guide. The ESLint plugin sorts classes without reformatting.

## Consequences

- **HeroUI components use React Aria's prop names:** `onPress`, `isDisabled`, `isOpen`.
- **Upgrades are in step:** HeroUI v3 requires Tailwind v4 and React 19, so major upgrades of any of the three go together.
- **More packages:** HeroUI brings React Aria and its peer packages, adding to the install size.
