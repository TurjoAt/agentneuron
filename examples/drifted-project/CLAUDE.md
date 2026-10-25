# Shop frontend

React 17 + TypeScript app built with Vite 5. Requires Node 18+.

## Commands

- `yarn install`: install dependencies
- `pnpm dev`: dev server on port 3000
- `pnpm test`: unit tests (Jest)
- `pnpm run typecheck`: type check
- `make release`: build and tag a release

## Conventions

- Components live in `src/components/`; the API client is `src/api/client.ts`.
- The app needs `DATABASE_URL` and `STRIPE_SECRET` set in the environment.
