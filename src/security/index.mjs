/* `shipprobe security <url>`: the free-scan checks, run on this machine.
 *
 *   keys       credentials in the shipped HTML and bundles, and a proof of the Supabase JWT
 *              signing secret when one is there
 *   database   Supabase detection, schema enumeration and the anonymous table sweep
 *   headers    HSTS, frame protection, CSP, nosniff, Referrer-Policy
 *   auth       insecure patterns in the shipped code
 *   stripe     Stripe detection, webhook signature probes and the success-page probe
 *
 * The cross-tenant probe, which signs up two throwaway users and reads across them, runs on the
 * hosted service only (`--hosted`). The report says so whenever a Supabase project is found.
 *
 * Exit codes: 1 on any critical or high finding, or a grade under --min-grade. 2 when the host
 * could not be reached or the run did not attest ownership. Never 0 for a host that was not read.
 */
import { newResult, PASS, FAIL, UNCHECKED } from '../result.mjs';
import { normalizeUrl, fetchPage, extractScripts, fetchBundles } from './fetch.mjs';
import { scanSecrets, scanJwtSigningSecret } from './secrets.mjs';
import { detectSupabase, enumerateTables, harvestClientTables, probeRestEndpoints } from './supabase.mjs';
import { checkHeaders } from './headers.mjs';
import { scanPatterns } from './patterns.mjs';
import { scanStripe, stripeFindings } from './stripe.mjs';
import { scoreFindings, summarize } from './score.mjs';

export const GRADES = ['A', 'B', 'C', 'D', 'F'];
const FAILING = new Set(['critical', 'high']);

/** The scan itself, with no verdict attached. Returns the raw engine output. */
export async function scan(rawUrl, { supabaseUrl } = {}) {
  const url = normalizeUrl(rawUrl);
  const host = new URL(url).host;
  const page = await fetchPage(url);
  if (!page.reachable && !page.html) {
    return { url, host, reachable: false, error: page.error || `HTTP ${page.status}`, findings: [], score: null, grade: null };
  }
  const { srcs, inline } = extractScripts(page.html, page.finalUrl);
  const bundles = await fetchBundles(srcs);
  const sources = [
    { url: page.finalUrl, text: page.html },
    ...inline.map((t, i) => ({ url: `${page.finalUrl}#inline-${i}`, text: t })),
    ...bundles,
  ];

  const findings = [];
  findings.push(...scanSecrets(sources));
  findings.push(...scanJwtSigningSecret(sources));

  const sb = detectSupabase(sources);
  const restBase = supabaseUrl ? supabaseUrl.replace(/\/+$/, '') : sb.url;
  let supabase = { detected: !!(sb.url || supabaseUrl), anonKey: !!sb.anonKey, tablesSwept: 0, openTables: [] };
  if (restBase && sb.anonKey) {
    const openApi = await enumerateTables(sb, restBase);
    const known = new Map(openApi.map((t) => [t.table, t]));
    for (const name of harvestClientTables(sources)) if (!known.has(name)) known.set(name, { table: name, columns: [] });
    const tables = [...known.values()];
    const rest = await probeRestEndpoints(sb, tables, openApi.length, restBase);
    findings.push(...rest.findings);
    supabase = { ...supabase, tablesSwept: Math.min(tables.length, 40), openTables: rest.openTables };
  }

  findings.push(...checkHeaders(page.headers).findings);
  findings.push(...scanPatterns(sources, page.html));
  const stripe = await scanStripe(sources, page.html, page.finalUrl, host);
  findings.push(...stripeFindings(stripe));

  const { score, grade, counts } = scoreFindings(findings);
  return {
    url,
    host,
    finalUrl: page.finalUrl,
    status: page.status,
    reachable: true,
    bundlesRead: bundles.length,
    bundlesFound: srcs.length,
    inlineScripts: inline.length,
    supabase,
    stripe: { detected: stripe.detected, detail: stripe.detail },
    findings,
    score,
    grade,
    counts,
    summary: summarize({ counts, grade }),
  };
}

/** The command: scan, then a verdict. */
export async function runSecurity(rawUrl, opts = {}) {
  const result = newResult('security', rawUrl);
  if (!rawUrl) {
    result.unchecked.push({ why: 'no URL. Usage: shipprobe security <url> --owner-confirmed' });
    return result;
  }
  if (!opts.ownerConfirmed) {
    result.unchecked.push({
      why:
        'the scan reads the target\'s REST API and posts to its webhook routes, so it runs only on a site you own or are ' +
        'authorised to scan. Pass --owner-confirmed to say so. Nothing was fetched.',
    });
    return result;
  }
  if (opts.minGrade && !GRADES.includes(String(opts.minGrade).toUpperCase())) {
    result.unchecked.push({ why: `--min-grade "${opts.minGrade}" is not one of ${GRADES.join(', ')}.` });
    return result;
  }

  let s;
  try {
    s = await scan(rawUrl, opts);
  } catch (e) {
    result.unchecked.push({ where: rawUrl, why: `the scan could not run: ${e?.message || e}` });
    return result;
  }
  result.subject = s.url;
  if (!s.reachable) {
    result.unchecked.push({ where: s.host, why: `could not reach the host (${s.error}). A host that was not read gets no score.` });
    result.summary = `Could not reach ${s.host}.`;
    return result;
  }

  const minIdx = opts.minGrade ? GRADES.indexOf(String(opts.minGrade).toUpperCase()) : -1;
  const belowFloor = minIdx >= 0 && GRADES.indexOf(s.grade) > minIdx;
  result.findings = s.findings.map((f) => ({ ...f, failing: FAILING.has(f.severity) }));
  result.data = {
    score: s.score,
    grade: s.grade,
    counts: s.counts,
    host: s.host,
    bundlesRead: s.bundlesRead,
    bundlesFound: s.bundlesFound,
    supabase: s.supabase,
    stripe: s.stripe,
  };
  result.summary = `${s.host} scored ${s.score}/100, grade ${s.grade}. ${s.summary}`;
  result.notes.push(`Read the page, ${s.inlineScripts} inline script(s) and ${s.bundlesRead} of ${s.bundlesFound} script bundle(s).`);
  if (s.supabase.detected) {
    result.notes.push(
      s.supabase.anonKey
        ? `Supabase project found. ${s.supabase.tablesSwept} table(s) swept with the public anon key, ${s.supabase.openTables.length} returned rows. ` +
            'The cross-tenant probe did not run here: it signs up two throwaway users, so it runs on the hosted service. Add --hosted to include it.'
        : 'A Supabase project URL was found but no anon key, so there was no public endpoint to sweep. The cross-tenant probe needs one too.',
    );
  } else {
    result.notes.push('No Supabase client is shipped, so the database and cross-tenant checks did not apply. Nothing was scored as if they had passed.');
  }
  if (!s.stripe.detected) result.notes.push(s.stripe.detail);
  if (belowFloor) {
    result.findings.push({
      id: 'grade-below-floor',
      severity: 'high',
      title: `Grade ${s.grade} is below the floor of ${String(opts.minGrade).toUpperCase()}`,
      detail: `--min-grade ${String(opts.minGrade).toUpperCase()} was set and the scan graded ${s.grade}.`,
      failing: true,
    });
  }
  result.code = result.findings.some((f) => f.failing) ? FAIL : PASS;
  return result;
}

export { UNCHECKED };
