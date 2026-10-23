# TODO

## Now

- [/] Add `GET /invoices` pagination !high #api @due(2026-11-05) @maria
  - [x] Cursor format
  - [ ] Tests for empty pages
- [ ] Replace the legacy PDF renderer `src/billing/pdf-legacy.ts` !med #billing @due(2026-11-20)
- [ ] Document the outbox retry policy in the runbook #docs

## Next

- [ ] Support multi-currency totals !urgent #billing @due(2026-12-01) @idris
- [ ] Rate limit `POST /invoices` #api
- [ ] Remove the `LEGACY_TAX_TABLE` flag once the EU migration finishes #billing

## Done

- [x] Move to integer cents #billing
- [x] Outbox worker with backoff #billing !high
