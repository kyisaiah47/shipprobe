/* Credentials that should never reach a browser, read out of the shipped HTML and JS bundles.
 *
 * The dangerous ones for an app built fast are a Supabase service_role key (full database access,
 * row-level security bypassed) and any server-side provider key that was inlined by mistake through
 * a NEXT_PUBLIC_ or VITE_ prefix.
 */
import crypto from 'node:crypto';

export function redact(s) {
  if (s.length <= 12) return s.slice(0, 3) + '...';
  return s.slice(0, 6) + '...' + s.slice(-4);
}

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** A JWT's payload role. An anon key is meant to ship; a service_role key is fatal. */
function jwtRole(token) {
  try {
    const json = JSON.parse(b64(token.split('.')[1]));
    return json.role || json.r || null;
  } catch {
    return null;
  }
}

const RULES = [
  {
    id: 'supabase-service-role-key',
    title: 'Supabase service_role key shipped to the browser',
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: 'critical',
    refine: (m) => (jwtRole(m) === 'service_role' ? { severity: 'critical' } : null),
    detail: (m) =>
      `A service_role JSON Web Token (${redact(m)}) is present in client code. This key bypasses every row-level security policy, so anyone who views source can read, edit and delete the whole database.`,
  },
  {
    id: 'supabase-secret-key',
    title: 'Supabase secret key shipped to the browser',
    /* The newer key format. Supabase issues publishable and secret keys alongside the older anon
     * and service_role JWTs. The rule above decodes a payload, and a secret key has no payload to
     * decode, so it needs its own shape. */
    re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g,
    severity: 'critical',
    detail: (m) =>
      `A Supabase secret key (${redact(m)}) is present in client code. Like the service_role key it bypasses every row-level security policy.`,
  },
  {
    id: 'stripe-secret-key',
    title: 'Stripe secret key shipped to the browser',
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g,
    severity: 'critical',
    detail: (m) =>
      `A Stripe ${/live/.test(m) ? 'live' : 'test'} secret key (${redact(m)}) is exposed in client code. It can create charges and refunds and read every customer on the account.`,
  },
  {
    id: 'openai-key',
    title: 'OpenAI API key exposed',
    /* `(?!ant-)` keeps this from also matching an Anthropic key, which shares the `sk-` prefix.
     * Without it one exposed key produced two findings, and the first named the wrong vendor. */
    re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    severity: 'high',
    detail: (m) => `An OpenAI API key (${redact(m)}) is in the shipped bundle. Anyone can run up its usage bill.`,
  },
  {
    id: 'anthropic-key',
    title: 'Anthropic API key exposed',
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    severity: 'high',
    detail: (m) => `An Anthropic API key (${redact(m)}) is in the shipped bundle and can be used to bill its account.`,
  },
  {
    id: 'google-api-key',
    title: 'Google API key exposed',
    re: /\bAIza[0-9A-Za-z_-]{30,}/g,
    severity: 'medium',
    detail: (m) => `A Google API key (${redact(m)}) is exposed. If it is unrestricted it can be used against its quota and billing.`,
  },
  {
    id: 'aws-access-key',
    title: 'AWS access key exposed',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    severity: 'critical',
    detail: (m) => `An AWS access key id (${redact(m)}) is in client code. With its secret it grants access to the AWS account.`,
  },
  {
    id: 'private-key-block',
    title: 'Private key block shipped to the browser',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    severity: 'critical',
    detail: () => 'A PEM private key block is embedded in the shipped code. A private key must never leave the server.',
  },
  {
    id: 'sendgrid-key',
    title: 'SendGrid API key exposed',
    re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    severity: 'high',
    detail: (m) => `A SendGrid key (${redact(m)}) is exposed and can send mail as its domain.`,
  },
  {
    id: 'github-token',
    title: 'GitHub token exposed',
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
    severity: 'high',
    detail: (m) => `A GitHub token (${redact(m)}) is in the bundle and may grant access to repositories.`,
  },
  {
    id: 'generic-secret-env',
    title: 'Server-side secret exposed through a public env variable',
    re: /\b(?:NEXT_PUBLIC|VITE|REACT_APP|PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|API_KEY|TOKEN)[A-Z0-9_]*\s*[:=]\s*["'][^"']{12,}["']/g,
    severity: 'high',
    detail: (m) => {
      const name = (m.match(/[A-Z0-9_]+(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|API_KEY|TOKEN)[A-Z0-9_]*/) || [''])[0];
      return `The variable ${name} looks like a server secret but carries a public prefix, so its value ships to every visitor.`;
    },
  },
];

/** Every credential-shaped string in `text`, replaced by its redacted form. Used before any file
 *  content leaves the machine for a model. */
export function redactSecrets(text) {
  let out = String(text);
  for (const rule of RULES) out = out.replace(new RegExp(rule.re.source, 'g'), (m) => `[redacted ${rule.id} ${redact(m)}]`);
  return out;
}

function shortSource(url) {
  try {
    const u = new URL(url);
    return u.pathname.split('/').pop() || u.host;
  } catch {
    return url;
  }
}

/** One finding per rule; the first location wins. */
export function scanSecrets(sources) {
  const found = new Map();
  for (const { url, text } of sources) {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      let hits = 0;
      while ((m = rule.re.exec(text)) && hits < 5) {
        const raw = m[0];
        let severity = rule.severity;
        if (rule.refine) {
          const r = rule.refine(raw);
          if (r === null) continue;
          if (r.severity) severity = r.severity;
        }
        hits++;
        if (found.has(rule.id)) continue;
        found.set(rule.id, {
          id: rule.id,
          category: 'keys',
          severity,
          title: rule.title,
          detail: rule.detail(raw),
          where: shortSource(url),
          evidence: redact(raw),
        });
      }
    }
  }
  return [...found.values()];
}

/* ── THE SUPABASE JWT SIGNING SECRET ─────────────────────────────────────────────────────────
 *
 * The anon and service_role keys ARE JWTs. The signing secret is what signs them. Anyone holding
 * it can mint a token with any role and any user id, so it defeats every row-level security
 * policy on the project. It has no payload to decode; it is a bare random string.
 *
 * SO IT IS PROVED, NOT PATTERN MATCHED. A regex for "a 40 character random string" fires on build
 * hashes, nonces and asset digests on every site. The app hands over the proof: its anon key is
 * public and is signed with exactly this secret. For every candidate the anon key's HS256
 * signature is recomputed. A string that reproduces it IS the key. There is no false positive
 * available short of a broken SHA-256.
 */
function supabaseJwts(text) {
  const out = [];
  const re = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  let m;
  while ((m = re.exec(text)) && out.length < 8) {
    try {
      const payload = JSON.parse(b64(m[0].split('.')[1]));
      if (payload && (payload.iss === 'supabase' || payload.ref) && payload.role) out.push(m[0]);
    } catch {
      /* an unreadable token proves nothing */
    }
  }
  return [...new Set(out)];
}

/** Candidate secrets: a named one first, then bare strings of roughly the right shape. Bounded,
 *  because a hostile bundle must not turn the scan into a loop. One HMAC is microseconds, so
 *  casting wide costs CPU and nothing else: a candidate that is not the key fails to verify. */
function secretCandidates(text) {
  const out = new Set();
  const named = /(?:JWT[_-]?SECRET|SUPABASE[_-]?JWT[_-]?SECRET|jwtSecret|signingSecret)\s*[:=]\s*['"`]([^'"`\s]{16,200})['"`]/gi;
  let m;
  while ((m = named.exec(text)) && out.size < 64) out.add(m[1]);
  const bare = /[A-Za-z0-9+/=_-]{32,64}/g;
  while ((m = bare.exec(text)) && out.size < 2000) out.add(m[0]);
  return [...out];
}

function signs(jwt, secret) {
  const i = jwt.lastIndexOf('.');
  if (i < 0) return false;
  const signingInput = jwt.slice(0, i);
  const given = jwt.slice(i + 1);
  try {
    const want = crypto
      .createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    if (want.length !== given.length) return false;
    return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(given));
  } catch {
    return false;
  }
}

/** Either a proof or a pass. A check that is silent when it succeeds cannot be told apart from a
 *  check that never ran, so when there is an anon key to test against and nothing verifies, the
 *  pass is stated. With no project key in the bundle there is no proof available and nothing is
 *  said. */
export function scanJwtSigningSecret(sources) {
  const keys = [...new Set(sources.flatMap(({ text }) => supabaseJwts(text)))];
  if (!keys.length) return [];
  for (const { url, text } of sources) {
    for (const cand of secretCandidates(text)) {
      for (const jwt of keys) {
        if (!signs(jwt, cand)) continue;
        return [
          {
            id: 'supabase-jwt-signing-secret',
            category: 'keys',
            severity: 'critical',
            title: 'Supabase JWT signing secret shipped to the browser',
            detail:
              `The secret that signs this project's access tokens (${redact(cand)}) is present in client code. ` +
              'Anyone who views source can mint a token with any role and any user id, which defeats every row-level ' +
              'security policy. Rotating it is the only fix, and it invalidates every token already issued.',
            evidence: `verified: it reproduces the HS256 signature of the app's own public key ${redact(jwt)}`,
            where: shortSource(url),
          },
        ];
      }
    }
  }
  return [
    {
      id: 'jwt-signing-secret-absent',
      category: 'keys',
      severity: 'pass',
      title: 'JWT signing secret is not in the bundle',
      detail: `Every candidate string in the shipped code was tested against the app's own public key (${redact(keys[0])}) and none of them signs it.`,
    },
  ];
}
