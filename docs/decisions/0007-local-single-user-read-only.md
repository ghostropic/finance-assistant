# 0007: Local, single-user, read-only

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The app will eventually hold real bank data.

## Decision

The app runs only on localhost for one user, with no login, and requests only read-only Plaid products.

## Why

- No authentication, multi-tenancy or hosting to build, so effort goes into the parts worth learning.
- Read-only products mean the app can't move money, even if something goes wrong.
- Keeping it local limits who could ever reach the data.

## Alternatives considered

- **Hosted, with authentication:** Would allow phone access. Deferred; it would need real authentication and a security review first.

## Consequences

- Deploying it later means revisiting this decision. See [security.md](../security.md).
