# Architecture

```
HTTP -> src/api (validation, auth) -> src/billing (rules) -> Postgres
                                          |
                                          `-> outbox table -> worker -> accounting API
```

- `src/api/invoices.ts` : `POST /invoices`, `GET /invoices/:id`
- `src/billing/totals.ts` : subtotal, discounts, tax
- `src/billing/tax.ts` : per-region tax tables

See [testing](testing.md) before adding endpoints. Operational notes are in the [runbook](runbook.md).
