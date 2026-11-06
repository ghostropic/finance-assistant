# 0002: Postgres with Prisma, raw SQL for aggregates

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Synced transactions need to be stored and queried, mostly with date filters and grouped totals.

## Decision

Postgres, accessed with Prisma 7 (with the `pg` driver adapter) for the schema, migrations and simple queries. Aggregate queries (totals by category, period comparisons) use Prisma's `$queryRaw` tagged templates, which send values as bind parameters.

## Why

- Postgres is a real production database and good practice; it handles `numeric` money and date maths well.
- Prisma gives a typed client and versioned migrations.
- Grouped totals are clearer and faster in SQL than in ORM query builders.

## Alternatives considered

- **SQLite:** Simpler (one file, no server) and enough for one user. Rejected because practising with Postgres was a goal.
- **Drizzle:** Closer to SQL and lighter. A fine choice; Prisma was picked for its migration workflow and wide use.
- **Plain `pg`:** Most control, but no schema management or types.
- **Prisma TypedSQL (`.sql` files with generated types):** Stronger typing for raw queries, but it needs a live database to generate types and our filters are built dynamically. `$queryRaw` with typed result rows is enough here.
- **Prisma 8:** Still a release candidate as of 2026-10-02. Prisma 7.10 is the current stable release.

## Consequences

- Postgres has to be running locally (Docker, Postgres.app or Homebrew).
- Money is stored as `numeric(14,2)`, which Prisma returns as `Decimal`; tools convert to numbers only when formatting results.
