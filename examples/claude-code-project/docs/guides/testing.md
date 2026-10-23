# Testing

- Unit tests next to the rules: `test/billing/*.test.ts`.
- API tests use a throwaway Postgres schema per run.
- Money assertions compare integer cents; a test that uses floating point is a bug.

Run a single file: `npx vitest run test/billing/totals.test.ts`.
