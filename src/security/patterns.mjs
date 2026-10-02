/* Broken-auth and insecure-pattern signals read from the shipped code. These are signals, not
 * proofs, and each one is worded that way: we saw X, which usually means Y. */

const PATTERNS = [
  {
    id: 'client-side-admin-flag',
    title: 'Admin access decided in the browser',
    severity: 'high',
    test: (all) =>
      /(isAdmin|is_admin|role\s*===?\s*["']admin["']|user\.admin|localStorage\.(get|set)Item\(["']?(role|isAdmin|admin)|hasRole\(["']admin)/i.test(all),
    detail:
      'The app appears to decide who is an admin in client-side JavaScript (an isAdmin or role check in the browser). Anyone can flip that flag in dev tools. Authorisation has to be enforced on the server or by row-level security.',
  },
  {
    id: 'jwt-in-localstorage',
    title: 'Auth token stored where an injected script can read it',
    severity: 'medium',
    test: (all) => /localStorage\.(set|get)Item\(\s*["'][^"']*(token|jwt|session|auth)/i.test(all),
    detail:
      'Session tokens are read from or written to localStorage, which any injected script can read. One XSS then means account takeover. An httpOnly cookie keeps the token out of reach of scripts.',
  },
  {
    id: 'sequential-id-fetch',
    title: 'Records fetched by a guessable sequential id',
    severity: 'medium',
    test: (all) =>
      /\/(users?|orders?|invoices?|accounts?|documents?|files?)\/["'`]?\s*\+\s*(id|\w*Id)\b/i.test(all) || /\?id=`?\$\{?\s*\+\+?/.test(all),
    detail:
      'The app looks up records by an id concatenated into the URL (/orders/ + id). If the endpoint is not scoped to the signed-in user, changing the number walks through every other user\'s record.',
  },
  {
    id: 'exposed-admin-route',
    title: 'Admin route referenced in the bundle',
    severity: 'low',
    test: (all) => /["'`]\/(admin|dashboard\/admin|superadmin|internal)(["'`/])/i.test(all),
    detail: 'An /admin-style route is referenced in client code. Confirm the server protects it: a client route guard is bypassed by requesting the data endpoint directly.',
  },
  {
    id: 'debug-mode-on',
    title: 'Debug mode shipped to production',
    severity: 'low',
    /* `(?<![\w$])` before `debug` keeps a dependency's own config string (a key that merely ends in
     * "debug") from reading as the app's debug flag. A dot is allowed before it on purpose:
     * `window.debug = true` is the real thing. */
    test: (all) => /((?<![\w$])debug\s*[:=]\s*true\b|NODE_ENV\s*[:=]\s*["']development|console\.debug\s*\(|__DEV__\s*=\s*true\b)/.test(all),
    detail: 'The production bundle carries debug flags. These often log tokens, ids and internal errors to the console.',
  },
];

export function scanPatterns(sources, html) {
  const all = sources.map((s) => s.text).join('\n') + '\n' + html;
  return PATTERNS.filter((p) => p.test(all)).map((p) => ({
    id: p.id,
    category: 'auth',
    severity: p.severity,
    title: p.title,
    detail: p.detail,
    where: 'shipped JavaScript',
  }));
}
