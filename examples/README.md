# The worked example: demo-app

demo-app is the app that BreachProbe scans in its worked example. It is rebuilt here as a local fixture. It is a small notes site with a browser bundle that talks to a hosted database. It carries the defects that BreachProbe's sample report finds.

```sh
node examples/run.mjs      # or: npx shipprobe demo
```

After you clone the repository, `npm install` and then `npm run example` install Playwright's Chromium and run the same file. When you run `run.mjs` as a script, it writes each command's output to `examples/out/`, the sign-up page's 1280px picture to `examples/out/shots/`, and the exit codes to `examples/out/summary.json`. `npx shipprobe demo` writes nothing.

Nothing leaves your machine. `serve.mjs` serves the site and a stand-in for its database on loopback. It signs a fresh public key for the bundle each time it starts, so no key is stored in this repository.

| Step | Command | Exit |
| --- | --- | --- |
| Score the repository's AGENTS.md | `shipprobe agents-md breachprobe-demo-app` | 0 |
| Check a vendored package that downloads a binary at install | `shipprobe deps breachprobe-demo-app/vendor/thumbs` | 1 |
| Scan the running app | `shipprobe security <url> --owner-confirmed --supabase-url <url>` | 1 |
| Check the sign-up page, which has a known contrast failure | `shipprobe page breachprobe-demo-app/site/signup.html` | 1 |
| Check the site against its plan | `shipprobe plan breachprobe-demo-app/plan.spec.json breachprobe-demo-app/site` | 0 |
| Run every gate before a deploy | `shipprobe promote --repo breachprobe-demo-app` | 1 |

The local scan finds six of the eight findings in BreachProbe's sample: the readable tables, the enumerable schema, the missing Content-Security-Policy and Referrer-Policy, the admin check in the browser, and the session token in localStorage. The other two findings are the cross-tenant read and the auto-confirmed sign-ups. They come from signing up two throwaway accounts, which only the hosted scan does with `--hosted`.

The sign-up page's hint text is `#b9bfc8` on white. The page check measures it at 1.85:1 against the pixels painted behind it. WCAG 1.4.3 asks for 4.5:1, so the check exits 1. The promote step serves the site and runs the plan, agent-file and page gates against it. The same finding blocks the promote step.

`run.mjs` exits 0 only when every command gives the exit code in this table.
