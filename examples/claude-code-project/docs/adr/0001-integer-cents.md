# 0001. Store money as integer cents

- Status: accepted
- Date: 2026-03-02

## Context

Floating point amounts produced one-cent differences between our totals and the accounting system.

## Decision

All amounts are integers in the smallest currency unit. Conversion to decimals happens only at the edges (display and import).

## Consequences

- Rounding rules are explicit in `src/billing/totals.ts`.
- Every API field for money is named `*_cents`.
