/* Security headers. A missing header rarely causes a breach on its own, and its absence is a
 * reliable sign that nobody hardened the deploy. Clickjacking and MIME sniffing are real for an
 * app that handles logins. */

const CHECKS = [
  {
    id: 'missing-hsts',
    header: 'strict-transport-security',
    title: 'No HTTPS enforcement (HSTS)',
    severity: 'medium',
    detail: 'Strict-Transport-Security is missing, so a visitor can be downgraded to plain HTTP and have their session taken on a hostile network.',
  },
  {
    id: 'missing-frame-options',
    header: 'x-frame-options',
    title: 'App can be embedded in a hostile iframe (clickjacking)',
    severity: 'medium',
    detail: 'Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so the app can be framed by an attacker and used for clickjacking against signed-in users.',
    ok: (v) => /deny|sameorigin/i.test(v),
  },
  {
    id: 'missing-csp',
    header: 'content-security-policy',
    title: 'No Content-Security-Policy',
    severity: 'medium',
    detail: 'There is no Content-Security-Policy, the most effective defence against cross-site scripting in an app that renders user input.',
  },
  {
    id: 'missing-content-type-options',
    header: 'x-content-type-options',
    title: 'MIME-type sniffing not disabled',
    severity: 'low',
    detail: 'X-Content-Type-Options: nosniff is missing, so a browser may guess content types and run an upload as script.',
    ok: (v) => /nosniff/i.test(v),
  },
  {
    id: 'missing-referrer-policy',
    header: 'referrer-policy',
    title: 'No Referrer-Policy',
    severity: 'low',
    detail: 'Referrer-Policy is unset, so full URLs, which can carry tokens or ids, are sent to every third-party site the app links to.',
  },
];

export function checkHeaders(headers) {
  const findings = [];
  const passed = [];
  const csp = headers.get('content-security-policy') || '';
  for (const c of CHECKS) {
    const v = headers.get(c.header) || '';
    let ok = v ? (c.ok ? c.ok(v) : true) : false;
    if (c.id === 'missing-frame-options' && /frame-ancestors/i.test(csp)) ok = true;
    if (ok) {
      passed.push(c.header);
      continue;
    }
    findings.push({ id: c.id, category: 'headers', severity: c.severity, title: c.title, detail: c.detail, where: 'HTTP response headers' });
  }
  return { findings, passed };
}
