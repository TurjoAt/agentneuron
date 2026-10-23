# Acme Billing API

Node.js + TypeScript service that creates invoices and syncs them to the accounting system.

@docs/guides/architecture.md
@docs/guides/testing.md
@docs/guides/runbook.md

## Commands

- `npm run dev` : start with hot reload on port 3000
- `npm test` : unit tests (Vitest)
- `npm run lint` : ESLint + type check
- `npm run db:migrate` : apply pending migrations

## Conventions

- All money is integer cents. Never use floats for amounts.
- Route handlers live in `src/api/`, business rules in `src/billing/`. Handlers stay thin.
- Every new endpoint needs a test in `test/api/` and an entry in `docs/guides/architecture.md`.
- Use the `db-migration` skill for schema changes; never edit applied migrations.
- Do not log customer email addresses or card data.

## Background

Why we use integer cents and an outbox table: see [ADR 0001](docs/adr/0001-integer-cents.md) and [ADR 0002](docs/adr/0002-outbox-pattern.md).

## Where things are

- Invoice totals: `src/billing/totals.ts`
- Tax rules: `src/billing/tax.ts`
- Legacy PDF renderer (being removed): `src/billing/pdf-legacy.ts`
