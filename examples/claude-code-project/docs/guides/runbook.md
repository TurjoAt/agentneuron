# Runbook

## The outbox is backing up

1. Check the worker logs.
2. Look at `src/billing/outbox-worker.ts` retry settings.
3. If the accounting API is down, do nothing; the worker retries with backoff.

Old notes about the PDF service lived in `docs/guides/pdf-service.md`.

TODO: add alert thresholds for outbox age.
