# 0008: Tests run on PGlite (in-memory Postgres)

- **Status:** Proposed (made during M1 while you were away; review)
- **Date:** 2026-10-02

## Context

The tool and sync tests need a real Postgres, because they test SQL. The plan said "a separate test database", which would need Docker (or another Postgres) running for every test run.

## Decision

Tests use [PGlite](https://pglite.dev): Postgres 17 compiled to WebAssembly, running inside the test process. A small helper (`tests/helpers/db.ts`) starts one per test file, applies the Prisma migrations, and serves it over the normal Postgres protocol with `@electric-sql/pglite-socket`, so the app's real Prisma client and `pg` adapter are used unchanged.

## Why

- `npm test` works with nothing running: no Docker, no test database to create or clean up.
- It's real Postgres, not a mock or SQLite, so date maths, `numeric`, `FILTER` and `ILIKE` behave as in production.
- Each test file gets a fresh database, so tests can't interfere with each other or with dev data.
- The whole suite runs in about 2 seconds.

## Alternatives considered

- **Separate database in the Docker Postgres:** Closest to production, but tests then depend on Docker and need cleanup between runs.
- **Testcontainers:** A throwaway Postgres container per run. Realistic, but slower and still needs Docker.
- **Mocking Prisma:** Fast, but the SQL itself, the part most likely to be wrong, would go untested.

## Consequences

- PGlite is single-connection (the socket server multiplexes), so tests use a pool of one connection. Fine for tests; not something to run the app on.
- If we ever rely on a Postgres extension PGlite lacks, those tests would need the Docker database.
