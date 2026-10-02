/* --hosted: the deeper checks that need a service, as optional extras on top of the local run.
 *
 *   security --hosted   BreachProbe's scan, which adds the signed-in cross-tenant probe: it signs
 *                       up two throwaway users through the app's public auth endpoint and checks
 *                       whether one can read the other's rows. It writes accounts into the
 *                       target's project, so it needs --owner-confirmed, and it runs there.
 *   agents-md --hosted  RuleStack scores the same files, so a drift between this copy of the
 *                       classifier and the gallery's is visible, and returns the badge.
 *   deps --hosted       ScriptProbe checks the package and records it in its public index.
 *
 * Every local check still runs first and on its own. A hosted call that fails is exit 2, because
 * it was asked for and did not happen; it is never folded into a pass.
 */
import { fetchJson } from '../net.mjs';
import { FAIL, UNCHECKED } from '../exit.mjs';

export const HOSTS = {
  breachprobe: () => (process.env.SHIPPROBE_BREACHPROBE_URL || 'https://breachprobe.thecompound.tech').replace(/\/+$/, ''),
  rulestack: () => (process.env.SHIPPROBE_RULESTACK_URL || 'https://rulestack.thecompound.tech').replace(/\/+$/, ''),
  scriptprobe: () => (process.env.SHIPPROBE_SCRIPTPROBE_URL || 'https://scriptprobe.thecompound.tech').replace(/\/+$/, ''),
};

const HOSTED_ONLY = new Set(['rls-cross-tenant', 'rls-correct', 'auto-confirm-signups']);

export async function hostedSecurity(result, url) {
  const base = HOSTS.breachprobe();
  const r = await fetchJson(`${base}/api/scan`, { method: 'POST', body: { url, ownerConfirmed: true }, timeout: 90000 }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok || !r.json) {
    result.unchecked.push({ where: `${base}/api/scan`, why: `the hosted scan answered HTTP ${r.status}: ${(r.json?.error || r.text || '').slice(0, 200)}` });
    return result;
  }
  const h = r.json;
  const added = (h.findings || []).filter((f) => HOSTED_ONLY.has(f.id));
  for (const f of added) {
    result.findings.push({ ...f, where: 'hosted cross-tenant probe', failing: f.severity === 'critical' || f.severity === 'high', hosted: true });
  }
  const reportUrl = h.scanId ? `${base}/report/${h.scanId}` : null;
  result.data.hosted = { service: base, score: h.score, grade: h.grade, reachable: h.reachable, rls: h.rlsTeaser || null, reportUrl };
  result.notes.push(
    `Hosted scan: ${h.reachable ? `${h.score}/100, grade ${h.grade}` : 'the host was not reachable from the service'}. ` +
      (h.rlsTeaser?.detail ? `${h.rlsTeaser.detail} ` : '') +
      (reportUrl ? `Report: ${reportUrl}` : ''),
  );
  if (added.some((f) => f.severity === 'critical' || f.severity === 'high') && result.code !== UNCHECKED) result.code = FAIL;
  return result;
}

export async function hostedAgentsMd(result, filesOnDisk, repo) {
  const base = HOSTS.rulestack();
  const local = result.data.files || [];
  if (!local.length) return result;
  const r = await fetchJson(`${base}/api/score`, { method: 'POST', body: { repo: repo || undefined, files: filesOnDisk.slice(0, 60) }, timeout: 60000 }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok || !r.json) {
    result.unchecked.push({ where: `${base}/api/score`, why: `RuleStack answered HTTP ${r.status}: ${(r.json?.error || r.text || '').slice(0, 200)}` });
    return result;
  }
  const remote = new Map((r.json.files || []).map((f) => [f.path, f]));
  const compared = [];
  for (const f of local) {
    const h = remote.get(f.path);
    if (!h) {
      result.warnings.push({ title: `RuleStack did not score ${f.path}`, detail: 'Its recogniser and this copy disagree about this path.' });
      continue;
    }
    compared.push({ path: f.path, local: f.quality, hosted: h.quality });
    if (h.quality !== f.quality) {
      result.warnings.push({ title: `${f.path}: ${f.quality}/100 here and ${h.quality}/100 on RuleStack`, detail: 'This copy of the classifier and the hosted one have drifted.' });
    }
  }
  result.data.hosted = { service: base, compared, badge: r.json.badge || null, gallery: `${base}/configs?sort=quality` };
  result.notes.push(`RuleStack scored ${compared.length} file(s) and agreed on ${compared.filter((c) => c.local === c.hosted).length}. Real configs to compare against: ${base}/configs?sort=quality`);
  if (r.json.badge?.markdown) result.notes.push(`Badge (it reads the nightly index, so an unindexed repository shows "not indexed"): ${r.json.badge.markdown}`);
  return result;
}

export async function hostedDeps(result) {
  const base = HOSTS.scriptprobe();
  const name = result.data.name;
  if (!name || result.data.source !== 'registry') {
    result.notes.push('--hosted checks registry packages; a local directory or tarball has nothing to look up.');
    return result;
  }
  const r = await fetchJson(`${base}/api/check`, { method: 'POST', body: { name, version: result.data.version }, timeout: 60000 }).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!r.ok || !r.json) {
    result.unchecked.push({ where: `${base}/api/check`, why: `ScriptProbe answered HTTP ${r.status}: ${(r.json?.error || r.text || '').slice(0, 200)}` });
    return result;
  }
  const h = r.json;
  result.data.hosted = { service: base, verdict: h.verdict, page: `${base}/p/${encodeURIComponent(name)}`, registry: h.registry || null };
  if (h.verdict && h.verdict !== result.data.verdict) {
    result.warnings.push({ title: `ScriptProbe's verdict is ${h.verdict}, this run's is ${result.data.verdict}`, detail: 'The two read the same tarball with the same rules, so a difference means one of them read a different version or a stale copy.' });
  }
  result.notes.push(`ScriptProbe: ${h.verdict}. Public page: ${base}/p/${encodeURIComponent(name)}`);
  return result;
}
