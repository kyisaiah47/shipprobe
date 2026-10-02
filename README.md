# ShipProbe

[![gates](https://github.com/kyisaiah47/shipprobe/actions/workflows/ci.yml/badge.svg)](https://github.com/kyisaiah47/shipprobe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/shipprobe.svg)](https://www.npmjs.com/package/shipprobe)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

ShipProbe is one tool for shipping safely. It checks a deployed app for exposed keys and open
database tables, checks what an npm package runs when it installs, scores the files that instruct
your coding agents, opens your pages in a real browser and measures them, and checks a build
against the plan it was meant to follow.

Every check is measured. A finding names the selector, file, header or package it is about, the
number it measured and the number it needed.

It fails closed. A check that could not run exits 2. It never exits 0 for something it did not
look at.

It runs offline. Every check runs on your machine or your CI runner. No ShipProbe service is
involved unless you ask for one with `--hosted`.

```sh
npx shipprobe demo
```

The demo runs every command against a fixture app and prints the exit code each one gives. See
[examples/](examples/README.md).

## Commands

| Command | What it checks |
| --- | --- |
| `shipprobe security <url> --owner-confirmed` | Keys in the shipped code, readable Supabase tables, security headers, insecure patterns and Stripe routes of a deployed app |
| `shipprobe deps <pkg>` | What an npm package runs at install, and whether its publishing account changed |
| `shipprobe agents-md [dir]` | AGENTS.md, CLAUDE.md, GEMINI.md, Cursor, Copilot, Windsurf and Cline instruction files |
| `shipprobe page <url\|file\|dir>` | Contrast, invisible text, clipped text, overflow, wrapped labels, the fold, dead scroll regions, layout, figures, tables and copy, in a real browser |
| `shipprobe plan <spec.json> <dir>` | An output directory against the sentences of an approved plan |
| `shipprobe promote` | Every gate in `shipprobe.json`, against a local production build, before a deploy |

Every command takes `--json`, `--quiet`, `--github`, `--fix` and, where a hosted check exists,
`--hosted`. `shipprobe --help` lists every flag.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Checked, and nothing failed. |
| `1` | Checked, and something failed. |
| `2` | Could not check. It never collapses into 0 or 1. |
| `3` | Checked, and the thing was never produced: no agent-instruction file, or a plan whose output does not exist yet. It is still not a pass. |

When results combine, as in `promote` and `page`, 2 wins over 1, 1 over 3, and 3 over 0.

## security

```sh
npx shipprobe security https://your-app.example --owner-confirmed
```

It reads what a visitor's browser receives: the page, its inline scripts and up to 12 script
bundles. Then it checks:

- **keys**: Supabase service_role and secret keys, Stripe secret keys, OpenAI, Anthropic, Google,
  AWS, SendGrid and GitHub keys, PEM private keys, and server secrets given a public env prefix.
  A Supabase JWT signing secret is proved, not guessed: every candidate string is tested against
  the app's own public key, and a string that reproduces its signature is the secret.
- **database**: when the app ships a Supabase client, the published schema and an anonymous read
  of each table. A table that returns rows with no login is a finding.
- **headers**: HSTS, frame protection, Content-Security-Policy, nosniff and Referrer-Policy.
- **auth**: an admin check decided in the browser, a session token in localStorage, sequential ids
  in record URLs, admin routes in the bundle and debug flags.
- **stripe**: when the app ships Stripe, an unsigned and a badly signed empty POST to its webhook
  route, a success page that confirms with nothing in the URL, a charge amount built in the
  browser, and a test key on a production host.

Any critical or high finding exits 1. `--min-grade B` also fails a grade below B. A host that
could not be reached exits 2 and gets no score.

`--owner-confirmed` is required. The scan reads the target's database API and posts to its webhook
routes, so it runs only on an app you own or are authorised to scan.

This is the scan of BreachProbe's own site, run on 2026-10-02:

```
shipprobe security  https://breachprobe.thecompound.tech/
  breachprobe.thecompound.tech scored 71/100, grade C. A few hardening gaps. Nothing open to walk
  through, and 3 things to tighten.

  info ! [medium] No HTTPS enforcement (HSTS)
  info ! [medium] App can be embedded in a hostile iframe (clickjacking)
  info ! [medium] No Content-Security-Policy
  info . [low] MIME-type sniffing not disabled
  info . [low] No Referrer-Policy

  note: Read the page, 37 inline script(s) and 12 of 17 script bundle(s).
  note: No Supabase client is shipped, so the database and cross-tenant checks did not apply.
  Nothing was scored as if they had passed.

  exit 0: checked, nothing failed
```

## deps

```sh
npx shipprobe deps esbuild@0.23.0
npx shipprobe deps ./vendor/some-package
npx shipprobe deps ./some-package-1.0.0.tgz
```

It reads the lifecycle scripts from the `package.json` inside the tarball, and the source of any
local file a script runs. The verdict is `pass` (no install script), `low` (a script that stays on
disk), `medium` (a native build, or a changed publishing account), `high` (a script that reaches
the network) or `critical` (a script that reaches the network, published by an account that
changed in the last ninety days). `--fail-on` sets the level that exits 1; the default is `high`.

```
shipprobe deps  esbuild@0.23.0
  esbuild@0.23.0: Reaches the network. A script reaches the network during install, downloading a
  file or calling another host.

  FAIL X [high] postinstall: downloads a platform-specific file over the network, runs another program through child_process.
         at postinstall -> install.js
         node install.js

  exit 1: checked, and something failed
```

## agents-md

```sh
npx shipprobe agents-md .
```

It finds every agent-instruction file in the repository and scores each from 0 to 100 on length,
section headings, runnable commands, coverage of build, test, lint, style and architecture,
explicit prohibitions, whether it names the repository's own paths, and worked examples. It prints
where each point came from. The repository score is the strongest file. Below `--threshold`
(default 60) it exits 1. With no instruction file at all it exits 3.

This repository, scored by itself:

```
shipprobe agents-md  .
  3 agent-instruction files. The repository scores 97/100 (strongest file AGENTS.md), at or above
  the threshold of 60.

  pass ok [pass] AGENTS.md scores 97/100 (AGENTS.md)
         Length 30/34 (372 words); Section headings 14/14 (7 headings); Runnable commands 20/20 (7
         commands an agent can execute); Core topic coverage 12/15 (3 of 5: build, test,
         code-style); Explicit prohibitions 7/7; Names this repository's own paths 8/8; Worked
         examples 6/6 (2 fenced code blocks).
```

## page

```sh
npm i -D playwright && npx playwright install chromium
npx shipprobe page https://your-app.example --sample 6
npx shipprobe page ./dist/index.html
```

It opens each page in Chromium, waits for fonts and scroll reveals, and measures it. A local file
or directory is served over loopback HTTP so its images can be read.

| Rule | What fails |
| --- | --- |
| `contrast` | Text under WCAG 1.4.3 and SVG marks under 1.4.11, against the background actually painted behind them. A failure is reviewed against the real pixels before it stands. Two-tone glyphs whose tones collapsed. |
| `visible` | Text that takes up space and is painted under 8% effective opacity, at a scroll position where a reader would see it, and again with reduced motion set |
| `clipped` | Text cut by an `overflow: hidden` box above it, or pushed past the start edge of its own scroll container |
| `overflow` | The page scrolls sideways at any width from 320 to 1920 |
| `wrap` | A nav link or button label breaks onto a second line |
| `fold` | The h1 runs past the fold at 1280x800 |
| `nested` | A nested scroll region that a real diagonal wheel cannot scroll, behind a positive control |
| `primary` | Two accent-filled controls on one screen. Runs when `--accent` names the accent |
| `dead-column` | Content that stops far short of the width the same page uses elsewhere |
| `page-chrome` | A route without the nav, footer or home link its own front page carries |
| `figure` | A picture at the full reading width that is not a band, a column of two, a cover, or a capture dense enough to read |
| `numeral-label` | A numeral set as the dominant type, paired with a small tracked caption |
| `table-shape` | A table whose rows are facts rather than comparable values |
| `noise` | Filler in the page's own copy |

`--only` and `--skip` choose rules by id, and an unknown id exits 2. `--vw` sets the widths the
per-width rules run at (default 1280). A page that answered HTTP 400 or more, showed a framework
error page, or put almost nothing on the screen exits 2: there was nothing to measure.

The contrast check is one implementation. It walks the flattened tree for the ground, skips boxes
that are not behind the text, composites translucent layers with alpha, reads colours through the
browser so `oklab()` and `color-mix()` resolve correctly, and multiplies opacity up the whole
ancestor chain. Where the stylesheet cannot know the ground, because a picture or a gradient sits
under the text, the pixels decide, and they can only clear a failure, never raise one. Text under a
blend mode or under an overlay is a warning, because the painted ink is not the declared colour.

The sign-up page in the worked example, which sets its hint text in `#b9bfc8` on white:

```
shipprobe page  examples/breachprobe-demo-app/site/signup.html
  FAIL X [high] contrast: 1.85:1 against the pixels painted behind it (10th percentile), needs 4.5:1 at 15px. rgb(185, 191, 200) on the painted backdrop. "We send a sign-in link to this address. It expires after fifteen minut"
         at main > form > p.hint @ http://127.0.0.1:60785/signup.html @1280px

  exit 1: checked, and something failed
```

## plan

```sh
npx shipprobe plan plan.spec.json ./out
```

A plan is approved as prose and broken in the shell. The spec turns each binding sentence into a
check, and each check carries that sentence in `quote`, so a failure prints the plan's own words.

```json
{
  "source": "docs/PLAN.md",
  "checks": [
    { "kind": "files", "glob": "docs/*.md", "min": 3, "max": 3, "quote": "Ship exactly three endpoint pages." },
    { "kind": "requires", "glob": "docs/*.md", "patterns": ["curl -"], "quote": "Every endpoint page carries a curl example." },
    { "kind": "forbids", "glob": "**/*.md", "patterns": ["billing-core"], "quote": "No page names the internal service." }
  ]
}
```

Fourteen check kinds ship. `files`, `requires`, `forbids`, `pairedFile`, `sidecar` and `media` read
the filesystem. `distinct`, `frameFill`, `luminance`, `accentShare`, `motionFloor`, `textInk`,
`markPresent` and `cutCadence` decode real video frames with ffmpeg. An unknown kind fails. A spec
with no checks, or one that cannot be read, exits 2. The output directory is always named; it is
never inferred.

```
shipprobe plan  test/fixtures/plan/spec.json against test/fixtures/plan/failing
  5 violation(s). The output does not match the plan.

  FAIL X [high] docs/*.md: found 2, the spec requires at least 3
         The plan says: "Ship exactly three endpoint pages: orders, refunds and webhooks."
  FAIL X [high] docs/refunds.md contains banned pattern /billing-core/i
         The plan says: "No page names the internal service billing-core."

  exit 1: checked, and something failed
```

## promote

```sh
npx shipprobe init       # writes shipprobe.json and plan.spec.json
npx shipprobe promote    # serves the build, runs every gate, exits non-zero on any finding
```

```json
{
  "serve": { "command": "npm run start", "url": "http://localhost:3000", "readyTimeoutMs": 20000 },
  "gates": [
    { "name": "plan", "shipprobe": ["plan", "plan.spec.json", "dist"] },
    { "name": "page", "shipprobe": ["page", "{url}"] },
    { "name": "tests", "run": ["npm", "test"] }
  ]
}
```

Gates run against a local production build before anything ships, so a finding blocks the deploy
instead of being written up after it. `{url}` in any argument becomes the address under test. A
missing gate file is a failure, not a skip. Zero gates run exits 2. A gate that could not check
makes the promote exit 2.

## GitHub Action

```yaml
- uses: kyisaiah47/shipprobe@v1
  with:
    command: security
    args: 'https://app.example.com --owner-confirmed'

- uses: kyisaiah47/shipprobe@v1
  with:
    command: page
    args: 'https://app.example.com --sample 6'

- uses: kyisaiah47/shipprobe@v1
  with:
    command: agents-md
    args: '. --threshold 70'
```

The action runs the same CLI with `--github`. Findings become annotations, the run writes a job
summary, and the step sets `exit-code`, `findings`, `summary`, `score`, `grade` and `report-path`
outputs. It installs Playwright and Chromium for `page` and `promote` unless
`install-browser: false` is set.

## Hosted extras

`--hosted` adds a check that needs a service. The local checks still run first, and a hosted call
that fails exits 2.

| Command | Adds |
| --- | --- |
| `security --hosted --owner-confirmed` | BreachProbe's cross-tenant probe: it signs up two throwaway users through the app's own sign-up endpoint and checks whether one can read the other's rows. The run links to the BreachProbe report. |
| `agents-md --hosted` | RuleStack scores the same files and returns the badge. A difference between the two scores is reported. |
| `deps --hosted` | ScriptProbe checks the package and records it in its public index. |

## Fix suggestions

```sh
npx shipprobe security https://your-app.example --owner-confirmed \
  --fix --provider anthropic --model <model-id>
```

`--fix` sends the failing findings and a bounded read of the repository (package.json, the
framework config files and the files the findings name) to a model you configure, and writes its
suggestions to `shipprobe-fixes.md`. `.env` files are never read, and every credential-shaped
string is redacted before the prompt is built.

| `--provider` | Endpoint | Key |
| --- | --- | --- |
| `openai` | chat completions | `OPENAI_API_KEY` |
| `anthropic` | messages | `ANTHROPIC_API_KEY` |
| `gemini` | generateContent | `GEMINI_API_KEY` |
| `openai-compatible` | chat completions at `--base-url`, including a local model | optional |
| `stub` | none; it writes a template and calls nothing | none |

There is no default provider and no default model. Without both, `--fix` exits 2 before anything
is checked. `SHIPPROBE_API_KEY` overrides the provider's own variable.

## App scaffold

```sh
npx shipprobe --app both ./shipprobe-app
cd shipprobe-app && npm install && npm run dev
```

`--app console`, `--app simple` or `--app both` writes a Next.js app that runs the security,
package and agent-file checks on its own server through ShipProbe's library. Console puts all three
checks on one screen with findings as tables. Simple leads with one scan, a labelled example and
the other checks behind disclosures. Both adds a welcome dialog and footer controls to switch,
and keeps typed input and finished results when you switch. The security route refuses private
addresses unless `SHIPPROBE_ALLOW_PRIVATE=1` is set.

## No escape hatch

There is no `--force`, no allowlist and no known-issues file. Each of those is a supported way to
record a failure and ship past it. If a check is wrong, the check is fixed in the open. If it is
right, the thing it checked is fixed.

## What it replaces

ShipProbe replaces leakless, stubless, glanceless and deferless.

| Old command | ShipProbe |
| --- | --- |
| `leakless gate --url <url> --owner-confirmed true` | `shipprobe security <url> --owner-confirmed --hosted` |
| `stubless gate` | `shipprobe agents-md .` |
| `glanceless <url>` | `shipprobe page <url>` |
| `deferless check <spec> <dir>` | `shipprobe plan <spec> <dir>` |
| `deferless promote` | `shipprobe promote` (reads `deferless.json` too) |
| `deferless render <url>` | `shipprobe page <url>` |

The npm packages `deferless` and `glanceless` now depend on ShipProbe and run it under their old
command names. The leakless and stubless actions at `@v1` keep working.

## Limitations

- The security scan reads what the browser receives. It cannot see server code, and its auth
  patterns are signals worded as signals.
- The page rules need Playwright and take real seconds per page.
- The pixel checks in `plan` need ffmpeg, and their thresholds were calibrated on dark product UI.
- A plan spec is only as complete as the sentences encoded in it.
- The app scaffold's private-address check cannot catch a public hostname that resolves to a
  private address. Put a public deployment behind an egress proxy if that matters.

## Tests

```sh
git clone https://github.com/kyisaiah47/shipprobe && cd shipprobe
npm install --no-save playwright && npx playwright install chromium
npm test
node scripts/scrub-gate.mjs
```

Every page rule has a fixture it must pass and one it must fail. The tests build any key-shaped
string they need at run time, never call a paid model, and run in a clean environment.

## Licence

MIT. Built and used in production by [Compound Labs](https://thecompound.tech).
