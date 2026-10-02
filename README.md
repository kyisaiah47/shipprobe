# ShipProbe

[![gates](https://github.com/kyisaiah47/shipprobe/actions/workflows/ci.yml/badge.svg)](https://github.com/kyisaiah47/shipprobe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/shipprobe.svg)](https://www.npmjs.com/package/shipprobe)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

ShipProbe checks deployed apps for exposed keys and open database tables. ShipProbe checks what an npm package runs during installation. ShipProbe scores files that instruct coding agents. ShipProbe opens pages in a real browser and measures them. ShipProbe checks a build against the plan it was meant to follow.

Every check is measured. A finding names the selector, file, header or package it covers. A finding reports the measured number and the required number.

ShipProbe fails closed. A check that could not run exits 2. ShipProbe never exits 0 for something it did not inspect.

ShipProbe runs offline. Every check runs on your machine or your CI runner. ShipProbe uses no service unless you pass `--hosted`.

```sh
npx shipprobe demo
```

The demo runs every command against a fixture app. The demo prints the exit code for each command. The examples are in [examples/](examples/README.md).

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

When `promote` and `page` combine results, code 2 takes precedence over code 1. Code 1 takes precedence over code 3. Code 3 takes precedence over code 0.

## security

```sh
npx shipprobe security https://your-app.example --owner-confirmed
```

The security scan reads what a visitor's browser receives. It reads the page, its inline scripts and up to 12 script bundles. The scan then checks the listed security conditions.

- **keys**: ShipProbe checks for Supabase service_role and secret keys, Stripe secret keys, OpenAI, Anthropic, Google, AWS, SendGrid and GitHub keys, PEM private keys, and server secrets given a public env prefix. It proves a Supabase JWT signing secret instead of guessing: it tests every candidate string against the app's own public key, and identifies a string that reproduces its signature as the secret.
- **database**: If the app ships a Supabase client, ShipProbe reads the published schema and anonymously reads each table. A table that returns rows with no login is a finding.
- **headers**: ShipProbe checks HSTS, frame protection, Content-Security-Policy, nosniff and Referrer-Policy.
- **auth**: ShipProbe checks an admin check decided in the browser, a session token in localStorage, sequential ids in record URLs, admin routes in the bundle and debug flags.
- **stripe**: When the app ships Stripe, ShipProbe sends an unsigned and a badly signed empty POST to its webhook route, checks a success page that confirms with nothing in the URL, checks a charge amount built in the browser, and checks for a test key on a production host.

Any critical or high finding exits 1. `--min-grade B` also fails a grade below B. A host that could not be reached exits 2. An unreachable host receives no score.

`--owner-confirmed` is required. The scan reads the target's database API and posts to its webhook routes. You can run the scan only on an app you own or are authorised to scan.

This scan covers BreachProbe's own site. The scan ran on 2026-10-02.

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

The deps check reads the lifecycle scripts from the `package.json` inside the tarball. It reads the source of any local file that a script runs. The verdict is `pass` when there is no install script. The verdict is `low` when a script stays on disk. The verdict is `medium` for a native build or a changed publishing account. The verdict is `high` when a script reaches the network. The verdict is `critical` when a script reaches the network and its publishing account changed in the last ninety days. `--fail-on` sets the level that exits 1. The default level is `high`.

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

The agents-md check finds every agent-instruction file in the repository. It scores each file from 0 to 100 on length, section headings, runnable commands, coverage of build, test, lint, style and architecture, explicit prohibitions, repository paths and worked examples. It prints where each point came from. The repository score is the strongest file score. A score below `--threshold` exits 1. The default threshold is 60. With no instruction file, the check exits 3.

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

The page check opens each page in Chromium. It waits for fonts and scroll reveals. It measures each page. The check serves a local file or directory over loopback HTTP so it can read the images.

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

`--only` and `--skip` choose rules by id. An unknown id exits 2. `--vw` sets the widths for per-width rules. The default width is 1280. A page that returns HTTP 400 or more exits 2. A page that shows a framework error page exits 2. A page with almost nothing on the screen exits 2. These pages provide nothing to measure.

`--shots <dir>` saves a full-page PNG for each rendered width. Each file uses the name `<width>.png`. The command creates the folder when it does not exist. The command captures pictures only at 1280px and wider. The ladder rules still measure 320, 375, 414 and 768px. The command does not capture those widths. The run prints a note naming those widths. With the default rules and widths, the folder gets `1280.png` and `1920.png`. Each `--vw` width of 1280 or more adds its own file. With several targets, every page writes the same file names. The folder therefore keeps the last page's pictures. A picture that cannot be saved exits 2. A run that renders no width of 1280 or more also exits 2.

```sh
npx shipprobe page ./dist/index.html --shots shots/
```

The contrast check uses one implementation. It walks the flattened tree to find the ground. It skips boxes that are not behind the text. It composites translucent layers with alpha. It reads colours through the browser so `oklab()` and `color-mix()` resolve correctly. It multiplies opacity through the whole ancestor chain. When a picture or gradient sits under the text, the stylesheet cannot determine the ground. The pixels then determine the result. The pixels can clear a failure but cannot raise one. Text under a blend mode or overlay produces a warning because the painted ink is not the declared colour.

The worked example's sign-up page sets its hint text in `#b9bfc8` on white.

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

ShipProbe includes fourteen check kinds. `files`, `requires`, `forbids`, `pairedFile`, `sidecar` and `media` read the filesystem. `distinct`, `frameFill`, `luminance`, `accentShare`, `motionFloor`, `textInk`, `markPresent` and `cutCadence` decode real video frames with ffmpeg. An unknown kind fails. A spec with no checks exits 2. A spec that cannot be read exits 2. The output directory is always named. ShipProbe never infers it.

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

Before a deploy, the gates run against a local production build. A finding blocks the deploy instead of being written up after it. `{url}` in any argument becomes the address under test. A missing gate file causes a failure instead of a skip. Zero gates cause exit 2. A gate that cannot check causes promote to exit 2.

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

`--hosted` adds a check that requires a service. The local checks run first. A hosted call that fails causes exit 2.

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

`--fix` sends the failing findings and a bounded read of the repository to a model you configure. The repository read includes package.json, the framework config files and the files named by the findings. The command writes the model's suggestions to `shipprobe-fixes.md`. It never reads `.env` files. It redacts every credential-shaped string before it builds the prompt.

| `--provider` | Endpoint | Key |
| --- | --- | --- |
| `openai` | chat completions | `OPENAI_API_KEY` |
| `anthropic` | messages | `ANTHROPIC_API_KEY` |
| `gemini` | generateContent | `GEMINI_API_KEY` |
| `openai-compatible` | chat completions at `--base-url`, including a local model | optional |
| `stub` | none; it writes a template and calls nothing | none |

ShipProbe has no default provider or default model. Without both, `--fix` exits 2 before it checks anything. `SHIPPROBE_API_KEY` overrides the provider's own variable.

## App scaffold

```sh
npx shipprobe --app both ./shipprobe-app
cd shipprobe-app && npm install && npm run dev
```

`--app console`, `--app simple` or `--app both` writes a Next.js app that runs the security, package and agent-file checks on its own server through ShipProbe's library. Console puts all three checks on one screen with findings as tables. Simple leads with one scan and a labelled example, then puts the other checks behind disclosures. Both adds a welcome dialog and footer controls for switching, and keeps typed input and finished results when you switch. The security route refuses private addresses unless `SHIPPROBE_ALLOW_PRIVATE=1` is set.

## No escape hatch

ShipProbe has no `--force`, allowlist or known-issues file. Each of those would record a failure and let the deploy proceed. If a check is wrong, the check is fixed in the open. If it is right, the checked thing is fixed.

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
| `deferless render <url> --shots <dir>` | `shipprobe page <url> --shots <dir>` |

The npm packages `deferless` and `glanceless` now depend on ShipProbe and run it under their old command names. The leakless and stubless actions at `@v1` keep working. `deferless render --shots` in deferless 0.1 saved a picture at every width from 320 to 1920. ShipProbe saves widths of 1280px and more. By default, it saves `1280.png` and `1920.png`.

## Limitations

- The security scan reads what the browser receives. It cannot see server code. It reports auth patterns as signals.
- The page rules need Playwright and take seconds per page.
- The pixel checks in `plan` need ffmpeg. Their thresholds were calibrated on dark product UI.
- A plan spec is only as complete as the sentences encoded in it.
- The app scaffold's private-address check cannot catch a public hostname that resolves to a private address. Use an egress proxy for a public deployment if that matters.

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
