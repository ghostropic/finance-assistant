# React & TypeScript Core Rules

Follow these rules exactly. When in doubt, choose the simpler, smaller, more modular approach.

Adapted from a style guide used in another project. The changes for this codebase are listed at the end under "Project adaptations"; where they differ from the rules above them, the adaptations win. Decision record: `docs/decisions/0010-code-style-guide.md`.

## Rules

1. **No inline functions in JSX** — extract handlers above `return`. Exceptions: one-liner setters on simple inputs, and `.map()` callbacks (but map bodies must not define further functions — extract a row component instead).
2. **No complex ternaries in JSX.** Object creation, multi-line expressions, calculations, nested ternaries → extract to a variable above `return`.
3. **No logic in JSX.** All computed values, boolean flags, and derived state must be named variables above `return`. JSX should read like a template.
4. **Component size limits.** Presentational: around 80 lines. Container/feature: around 200 lines. Context Provider: around 100 lines. Modal: around 150 lines.
5. **JSX max nesting depth: 4 levels.** Extract inner sections to subcomponents.
6. **Usually one responsibility per component.** Loading AND data fetching AND rendering → split it.
7. **No prop drilling past 3 levels.** Use Context instead.

---

## Component Structure

- **Arrow functions** for all components. Exception: `function` declarations for generic components where the syntax is cleaner.
- **File structure order:** Imports → Constants → Types/Interfaces → Helper functions (pure) → Component → Unexported subcomponents

### Extraction Rules

Extract a component when:

- A JSX block is > 40 lines or when it doesn't logically fit
- A ternary branch contains more than a single element
- Map callback needs local variables (extract a row component)
- Same UI pattern appears twice
- A section has its own state or handlers
- A form field is visually complex or has dependent validation

A component gets its own subdirectory when it has a stylesheet, subcomponents, or lives in a shared/design system package. Otherwise, a single `.tsx` file in `components/` is fine.

---

## Styling and UI components

- **HeroUI first.** Use a HeroUI v3 component (`@heroui/react`) when one fits: `Button`, `TextArea`, `Alert`, `Disclosure`, `Drawer`, `Spinner`, and so on. They're built on React Aria, so keyboard and screen-reader behavior comes with them. Compound parts are used as properties: `<Drawer.Content>`, `<Alert.Description>`.
- **HeroUI events follow React Aria:** `onPress`, not `onClick`; `isDisabled`, `isPending`, `isOpen`. Plain HTML elements keep their usual `onClick` and `disabled`.
- **Tailwind utility classes** for everything else: layout, spacing, type and one-off styling.
- **Colors come from the theme**, never raw values: `bg-surface`, `text-muted`, `border-border`, `bg-accent-soft`, `text-danger`. These are HeroUI's theme colors, and they switch with light and dark mode. The theme lives in `src/app/globals.css`.
- **Conditional classes** go through `cn()` from `@heroui/react`, with semantic booleans: `cn("rounded-lg border", hasError && "border-danger")`. Build long or conditional class lists in a variable above `return`.
- **A CSS module** (`Component.module.css`, next to the component) only for:
  - HTML you don't render yourself, such as react-markdown output
  - pseudo-elements and browser-specific selectors
  - custom `@keyframes` (prefer Tailwind's `animate-*` when one fits)
  - styles that would be unreadable as a class list

  Modules use theme variables (`var(--color-border)`), never raw colors, and start with a one-line comment saying why they exist. Add `@reference "<path to globals.css>";` only when a module needs `@apply`.

---

## Feature Directory Structure

```
feature-name/
├── FeatureName.tsx            # Main/entry component
├── FeatureName.module.css     # Optional: styles Tailwind can't cover (see Styling)
├── FeatureNameWrapper.tsx     # Optional: provider wrapper
├── FeatureName.context.tsx    # Optional: feature context
├── index.ts                   # Barrel exports (public API only)
├── types.ts                   # Types and interfaces
├── api.ts                     # API functions
├── utils.ts                   # Data transforms, helpers
├── constants.ts               # Constants and defaults
├── components/                # Subcomponents
├── hooks/                     # Custom hooks (use-*.ts)
└── __tests__/                 # Tests
```

Index files export only the public API — hide internal components, hooks, and utils.

---

## Whitespace & Readability

Separate logical sections in component body with blank lines, in this order:

1. Hooks (grouped) → 2. State (grouped) → 3. Derived values → 4. Data fetching (useCallback) → 5. Handlers (blank line between each) → 6. Computed flags → 7. Effects → 8. Return

**Formatting:** Prettier decides layout. Do not add optional semicolons; the formatter keeps only semicolons required by JavaScript or TypeScript syntax.

**Type/interface definitions:** blank line after, before the component export.

---

## TypeScript

- **`interface`** for props, context types, object shapes. **`type`** for unions, intersections, mapped/utility types.
- Exported props: descriptive name matching component (`DataGridProps<RowData>`). Internal: `Props` is fine.
- Use generics when a component/hook handles multiple data shapes.
- **Finite string sets** are defined once and referenced by name — see "Project adaptations" for how (this project doesn't use TypeScript `enum`).
- Separate request types from entity types (`Bio` vs `BioRequest`).
- Use library types directly — don't create unnecessary wrapper types.

---

## JSX Rules

- **Extract all computed values** before `return` into named semantic variables.
- **Ternaries allowed inline:** simple value switching (`isPaid ? 'Paid' : 'Unpaid'`), single prop switching, simple component switching.
- **Ternaries must be extracted:** object creation, multi-line, calculations, nested ternaries → variable. Branches > 5 lines or containing `.map()` → subcomponent.
- **Conditional `&&`:** conditions must be semantic booleans (`hasPaginationInfo`, `showBulkActions`), not raw expressions.
- **Loading pattern:** keep the page shell visible during loading and show loading state inline where the content will appear. Early returns only for permission/feature gates in wrapper components.
- **Map callbacks:** Keep simple — if you need local variables, extract a row component.

---

## Hooks (Quick Reference)

- **useContext:** Use directly. Never wrap in a custom hook.
- **Custom hooks:** For reusable logic (data fetching, form helpers, shared derived logic). Not context wrappers.
- **useCallback:** For async effect deps, functions passed to children, context provider values. Not for simple same-component handlers.
- **useEffect:** For mount fetching, URL sync, error toasts, external lib integration. Not for derived state or prop transforms.
- **useEffect deps:** Mount-only → `[]` (suppress lint if needed). Sync → include values being synced.
- **useMemo:** For expensive computations or referentially stable objects. Not for simple derivations.

---

## Props

- Destructure in function signature: `({ bar, baz }: Props)`
- Spread props to native elements when wrapping: `<button {...rest}>`
- Provide explicit types — no implicit `any`
- JSDoc comments on exported interface props

---

## Naming Conventions

| Thing                       | Convention                        | Example                 |
| --------------------------- | --------------------------------- | ----------------------- |
| Components                  | PascalCase                        | `UserCard`              |
| Component files             | PascalCase                        | `UserCard.tsx`          |
| Hook files                  | kebab-case with `use-`            | `use-workflows.ts`      |
| Util/API/type files         | kebab-case                        | `utils.ts`, `api.ts`    |
| Directories                 | kebab-case                        | `email-compose/`        |
| Props interfaces            | PascalCase + `Props`              | `UserCardProps`         |
| Context types               | PascalCase + `ContextType`        | `SiteBiosContextType`   |
| Event handlers (multi-step) | `handle` + verb                   | `handleSubmit`          |
| Event handlers (direct)     | semantic verb                     | `resetFilters`          |
| Booleans                    | `is*`, `has*`, `show*`, `should*` | `isLoading`, `hasError` |
| State setters               | `set` + name                      | `setIsLoading`          |
| Async fetchers              | `fetch*` or `load*`               | `fetchBios`             |
| Transforms                  | `transform*` or `map*To*`         | `transformFileMetadata` |
| Constants                   | UPPER_SNAKE_CASE                  | `DEFAULT_PAGE_SIZE`     |

---

## Imports

Order: React/core → Router → UI library → External utils → Internal absolute → Relative → Styles → Types

Alias third-party imports when names conflict with your code.

---

## Comments

- **No comments that restate the code.** Code should be self-documenting: if a comment explains _what_ the code does, refactor instead (better names, extraction).
- **Keep short comments that explain _why_** when no name can carry it: a security reason, a third-party API quirk, a constraint from another system, or a decision record. Point to the doc or decision record when there is one.
- **JSDoc** on exported interfaces/props, and on exported functions whose contract isn't obvious from the signature.

---

## Project adaptations

Changes from the original guide, and why. These take precedence where they differ.

1. **Styling is Tailwind v4 and HeroUI v3**, with CSS modules only for the cases listed under "Styling and UI components". The original guide assumed SCSS modules; the project has no Sass. See decision record 0011.
2. **No TypeScript `enum`.** Finite sets are defined once and referenced by name, in one of these ways:
   - **Wire and data values** (SSE event types, turn statuses, tool names, API JSON) use **string literal union types**, and discriminated unions on a `type` field. These values cross JSON boundaries (the database, SSE, the Claude API), where literal unions type-check end to end and an `enum` adds nothing.
   - **Sets needed at runtime** (to validate, iterate or build schemas) are an `as const` array or object in UPPER_SNAKE_CASE, with the union derived from it. Example: `PRIMARY_CATEGORIES` in `src/tools/spending.ts`, used by Zod.
   - **A library's own constants are used directly:** `AccountType.Credit` from `plaid`, `Products.Transactions`, and so on.
3. **Comments:** the original says no inline comments at all. This codebase keeps short _why_ comments (see "Comments" above). They record things like why the dev server binds to `127.0.0.1`, why sync restarts from the first cursor, and why card autopays aren't spending, which no variable name can express.
4. **Loading:** the original names a `LoaderSkeleton` component. This project has none; follow the intent (keep the shell, load inline).
5. **Tests** that cover server modules (tools, sync, agent loop, API helpers) live in the top-level `tests/` folder, because they need the in-memory Postgres helpers. `__tests__/` inside a feature folder is for that feature's own UI tests.
6. **Server modules:** the React rules apply to `.tsx`. For plain `.ts` (tools, sync, agent, server, scripts), the TypeScript, naming, import and comment rules apply. Tool handler functions are named after their tool (`getBalances` for `get_balances`), so a tool's name maps directly to its code.
7. **Constants:** UPPER_SNAKE_CASE for fixed values and lists. Zod schemas and other configured objects use camelCase (`searchTransactionsInput`).
8. **Next.js special files** (`page.tsx`, `layout.tsx`, `route.ts`) keep the names and exports Next.js requires. Route handlers are exported `async function`s, as Next.js documents them.
9. **Formatting is Prettier's**, with `semi: false`, instead of the original's hand layout rules for JSX. Run `npm run format`. See decision record 0015.

## Enforced by ESLint

Where a rule can be checked automatically, `npm run lint` checks it and `npm run lint -- --fix` fixes most of it:

- arrow-function components
- JSX depth of 4
- import order
- Tailwind classes: consistent order, no unknown, conflicting, duplicate or deprecated classes (`eslint-plugin-better-tailwindcss`, which reads the theme from `src/app/globals.css`)

The other rules (no inline handlers, no logic in JSX, naming, comments, HeroUI-first) are checked in review. ESLint's `react/jsx-no-bind` would also flag handlers declared above `return`, which this guide asks for.

Layout is Prettier's: `npm run format` rewrites files and `npm run format:check` reports any that differ. `eslint-config-prettier` keeps ESLint from checking layout, so the two never disagree.
