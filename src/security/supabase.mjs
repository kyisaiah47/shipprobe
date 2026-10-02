/* Supabase detection and the anonymous REST sweep.
 *
 *   1. Open REST endpoints. A table that returns rows to the anon key means row-level security is
 *      off for it: anyone on the internet reads it.
 *   2. Schema enumeration. PostgREST publishes an OpenAPI document at the REST root, so the list
 *      of tables and columns is discoverable before any read.
 *
 * Everything here uses only the anon key the app already ships. The cross-tenant probe, which
 * signs up two throwaway users and reads across them, is not run locally: it writes accounts into
 * someone's project, so it stays on the hosted service behind its ownership attestation. Run
 * `shipprobe security <url> --hosted --owner-confirmed` to include it.
 */
import { timedFetch } from '../net.mjs';

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function detectSupabase(sources) {
  const all = sources.map((s) => s.text).join('\n');
  const urlM = all.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/);
  const ref = urlM ? urlM[1] : undefined;
  const url = urlM ? `https://${ref}.supabase.co` : undefined;
  let anonKey;
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  let m;
  while ((m = jwtRe.exec(all))) {
    try {
      const payload = JSON.parse(b64(m[0].split('.')[1]));
      if (payload.role === 'anon' && (!ref || payload.ref === ref || !payload.ref)) {
        anonKey = m[0];
        break;
      }
    } catch {
      /* not a readable JWT */
    }
  }
  if (!anonKey) {
    const pub = all.match(/sb_publishable_[A-Za-z0-9_-]{16,}/);
    if (pub) anonKey = pub[0];
  }
  return { url, ref, anonKey };
}

/** The tables PostgREST publishes, with their columns. */
export async function enumerateTables(sb, base = sb.url) {
  if (!base || !sb.anonKey) return [];
  try {
    const res = await timedFetch(`${base}/rest/v1/`, {
      headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` },
    });
    if (!res.ok) return [];
    const doc = await res.json();
    return Object.entries(doc.definitions || {}).map(([table, def]) => ({
      table,
      columns: Object.keys(def.properties || {}),
    }));
  } catch {
    return [];
  }
}

/** The tables the app's own code queries, `supabase.from('orders')`. This still finds the real
 *  tables when a project has locked its OpenAPI root. */
export function harvestClientTables(sources) {
  const names = new Set();
  const re = /\.from\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]{1,62})["'`]\s*\)/g;
  for (const { text } of sources) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) && names.size < 120) names.add(m[1]);
  }
  return [...names];
}

/*   rows > 0           row-level security is off or permissive: real data comes back. A leak.
 *   rows = 0, HTTP 200 row-level security is filtering, or the table is empty. Not a leak.
 *   blocked            401, 403 or 404. The safe outcome.
 * PostgREST answers 200 with [] for a filtered read, so a status alone never means "open". */
export async function anonRead(sb, table, base = sb.url) {
  if (!base || !sb.anonKey) return { rows: null, blocked: true };
  try {
    const res = await timedFetch(`${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, {
      headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, prefer: 'count=exact' },
    });
    if (res.status === 200) {
      const exact = (res.headers.get('content-range') || '').split('/')[1];
      const body = await res.json().catch(() => []);
      let rows = exact && exact !== '*' ? parseInt(exact, 10) : Array.isArray(body) ? body.length : 0;
      if (!Number.isFinite(rows)) rows = Array.isArray(body) ? body.length : 0;
      return { rows, blocked: false };
    }
    return { rows: null, blocked: true };
  } catch {
    return { rows: null, blocked: true };
  }
}

const SENSITIVE = /(user|profile|customer|account|payment|order|message|email|subscription|token|secret|admin|billing|invoice|lead|contact)/i;

export async function probeRestEndpoints(sb, tables, openApiCount = 0, base = sb.url) {
  const findings = [];
  if (!base || !sb.anonKey) return { findings, openTables: [], sensitiveOpen: [] };

  if (openApiCount > 0) {
    findings.push({
      id: 'rest-schema-enumerable',
      category: 'database',
      severity: 'low',
      title: 'Database schema is publicly enumerable',
      detail: `The Supabase REST API publishes an OpenAPI document listing all ${openApiCount} exposed tables and their columns to anyone with the public anon key. This is normal for Supabase, and it tells an attacker exactly what to target.`,
      where: `${sb.url || base}/rest/v1/`,
    });
  }

  const openTables = [];
  const sensitiveOpen = [];
  for (const { table, columns } of tables.slice(0, 40)) {
    const { rows, blocked } = await anonRead(sb, table, base);
    if (!blocked && rows !== null && rows > 0) {
      openTables.push(table);
      if (SENSITIVE.test(table) || columns.some((c) => /email|password|token|secret|stripe|card|ssn|phone/i.test(c))) {
        sensitiveOpen.push(table);
      }
    }
  }

  if (openTables.length) {
    const sens = sensitiveOpen.length;
    findings.push({
      id: 'open-rest-tables',
      category: 'database',
      severity: sens ? 'critical' : 'high',
      title: sens
        ? `${sens} sensitive table${sens > 1 ? 's' : ''} readable by anyone`
        : `${openTables.length} table${openTables.length > 1 ? 's' : ''} readable without logging in`,
      detail: sens
        ? `Anyone on the internet can read ${sens} table${sens > 1 ? 's' : ''} that hold user or account data, with no login, because row-level security is off. Affected: ${sensitiveOpen.slice(0, 8).join(', ')}.`
        : `${openTables.length} table${openTables.length > 1 ? 's' : ''} return rows to unauthenticated requests: ${openTables.slice(0, 8).join(', ')}. Row-level security is not enforcing who can read them.`,
      where: `${sb.url || base}/rest/v1/`,
    });
  }
  return { findings, openTables, sensitiveOpen };
}
