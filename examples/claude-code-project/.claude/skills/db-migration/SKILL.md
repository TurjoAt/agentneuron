---
name: db-migration
description: Create a safe database migration. Use for any schema change.
---

# Database migrations

1. Create `migrations/<timestamp>_<name>.sql` (see `migrations/README.md`).
2. Make it reversible: add a matching `down` section.
3. Add an index in the same migration when adding a foreign key.
4. Run `npm run db:migrate` against the test database and run `npm test`.
