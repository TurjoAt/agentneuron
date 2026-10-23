# 0002. Use an outbox table for accounting sync

- Status: accepted
- Date: 2026-04-11

## Context

Posting to the accounting API inside the request made invoice creation fail when that API was slow.

## Decision

Write an outbox row in the same transaction as the invoice, and let a worker deliver it.

## Consequences

- Invoice creation no longer depends on the accounting API.
- We need monitoring on outbox age (see the runbook).
