# AGENTS.md

This repository is a small HTTP service. The code lives in `src/`, the tests in `test/`, and the
build output in `dist/`.

## Setup

```sh
npm install
```

## Build

```sh
npm run build
```

The build compiles `src/` into `dist/`. Never edit `dist/` by hand.

## Tests

```sh
npm test
npm run test:watch
```

Every change to `src/handlers/` needs a test in `test/handlers/`. Write the failing test first.

## Lint and format

```sh
npm run lint
npx prettier --check .
```

## Code style

Prefer small pure functions. Name files after the route they serve. Do not use default exports.

## Architecture

- `src/server.ts` starts the server and mounts the routes.
- `src/handlers/` holds one file per route.
- `src/lib/` holds code shared by handlers.

## Rules

- Never commit a secret or an `.env` file.
- Do not add a dependency without asking.
- Do not modify files under `migrations/`.
