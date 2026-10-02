# AGENTS.md

demo-app is a small notes app. Its public site is in `site/`, its browser bundle is
`site/assets/app.js`, and its plan is `docs/PLAN.md`.

## Setup

```sh
npm install
```

## Build and serve

```sh
npm run serve
```

`npm run serve` serves `site/` on port 4178 through `../serve.mjs`, the same way it is deployed.

## Tests

```sh
npm test
npx shipprobe plan plan.spec.json site
npx shipprobe page site/signup.html
```

`npm test` runs every gate in `shipprobe.json`. A change to `site/` needs the page and plan gates to pass.

## Code style

Plain HTML and one script. Prefer semantic elements. Do not add a framework.

## Architecture

- `site/index.html` is the landing page and the reference for the nav and footer.
- `site/signup.html` is the sign-up form.
- `site/assets/app.js` talks to the database with the public anon key only.

## Rules

- Never ship a service_role key or any server secret in `site/`.
- Never decide who is an admin in `site/assets/app.js`; the database policies decide.
- Do not edit `vendor/`. It is a third-party package.
