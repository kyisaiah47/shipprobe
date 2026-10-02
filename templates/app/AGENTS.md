# AGENTS.md

This is a Next.js app that runs ShipProbe checks on its own server. It was scaffolded by
`shipprobe --app`.

## Setup and build

```sh
npm install
npm run dev
npm run build
npm run start
```

## Structure

- `app/api/check/route.ts` validates every input and calls ShipProbe. It is the only server code.
- `app/page.tsx` mounts the views. `components/ConsoleHome.tsx` and `components/SimpleHome.tsx` are the two views.
- `components/CheckState.tsx` holds drafts and results in memory, so they survive a view switch.
- `components/site-view/` holds the welcome dialog, the view controls and the disclosure.
- `lib/checks.ts` is the client side of the API. `lib/example.ts` scores this file for the Simple example.

## Tests

Run the ShipProbe CLI against the running app before shipping it:

```sh
npx shipprobe page http://localhost:3000
npx shipprobe agents-md .
```

## Rules

- Never let `app/api/check/route.ts` pass a path to `runDeps`. Package names only.
- Never remove the private-host check on the security route.
- Do not store drafts or results in localStorage. Only the view choice and the welcome setting go there.
- Every dropdown is a custom listbox in this app's own styling, never a native select element.
