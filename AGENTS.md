# AGENTS.md

ShipProbe is one CLI and one GitHub Action. Its commands are `security`, `deps`, `agents-md`,
`page`, `plan` and `promote`. It has no runtime dependencies. Playwright is an optional peer that
only `page` and the page gates of `promote` need.

## Setup

```sh
npm install --no-save playwright
npx playwright install chromium
```

## Tests

```sh
npm test
node test/run.mjs page plan
node scripts/scrub-gate.mjs --self-test
node scripts/scrub-gate.mjs
node examples/run.mjs
```

`npm test` runs every `test/*.test.mjs` file under node's test runner in a clean environment. The
page tests launch Chromium, so they fail without Playwright rather than skip. A change to a rule
needs a fixture in `test/fixtures/` that the rule passes and one it fails.

## Build

There is no build step. `src/` is plain ES modules and ships as written. `src/index.d.ts` is the
hand-written type declaration; update it when an exported signature changes.

## Architecture

- `bin/shipprobe.mjs` calls `main` in `src/cli.mjs`, which parses flags per command and prints.
- `src/security/`, `src/deps/`, `src/agents-md/`, `src/page/`, `src/plan/`, `src/promote/` hold one
  command each. Every runner returns the result shape in `src/result.mjs`.
- `src/page/contrast.mjs` is the only contrast implementation. The contrast and visible rules both
  read the text runs it measures, through `src/page/textruns.mjs`.
- `src/hosted/` is the optional `--hosted` extras. `src/fix/` is the `--fix` step and the provider
  interface. `src/app/` and `templates/app/` are the `--app` scaffold.
- `examples/` is the worked example, and `examples/run.mjs` is also `shipprobe demo`.

## Code style

ES modules, two-space indent, single quotes, no semicolon-free style. Comments explain why a guard
exists and what was measured, not what the next line does. Prefer a plain function over a class.

## Rules

- Never add `--force`, an allowlist, a known-issues file, or a flag that turns a failure into a
  warning. A wrong check is fixed in the open.
- Never let "could not check" become exit 0 or exit 1. It is exit 2.
- Never commit a credential-shaped string, even in a test. Build test keys at run time from parts,
  as `test/helpers/sites.mjs` does. The scrub gate fails on them.
- Never add bot-detection bypass code.
- Never call a paid model in a test. Tests use the stub provider or a local stand-in server.
- Do not add a runtime dependency.
