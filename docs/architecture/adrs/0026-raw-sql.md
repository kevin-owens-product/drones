# ADR 0026: Raw SQL instead of an ORM

Status: Accepted
Date: 2026-10-28

## Context

The security-critical behavior is SQL: RLS, definer functions, triggers, grants. An ORM that hides the statement makes review harder and makes it easier to bypass a policy with a relationship load.

## Decision

The API uses SQLAlchemy Core `text()` with bound parameters. There is no declarative model and no string-formatted SQL. Schema changes are versioned SQL files run by Alembic. Pydantic models are the application types.

## Consequences

A column rename is a migration plus a query change, with no mapper to drift from the database. Tests that matter run against Postgres, not SQLite, because SQLite will not enforce RLS.
