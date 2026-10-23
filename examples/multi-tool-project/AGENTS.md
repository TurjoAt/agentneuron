# Orbit Dashboard

React + TypeScript single-page app. This file is the source of truth for coding agents; other tools' files are generated from it or point to it.

## Setup

- `pnpm install`
- `pnpm dev` starts Vite on port 5173
- `pnpm test` runs Vitest

## Code style

- Use TypeScript strict mode. No `any` without a comment explaining why.
- Use 2 spaces for indentation.
- Prefer named exports over default exports.
- Components live in `src/components/`, one folder per component.
- Write a test for every new hook.

## Pull requests

- Keep PRs under 400 changed lines.
- Link the issue in the description.
- Read [the design notes](docs/design.md) before changing layout code.
