import test from 'node:test';
import assert from 'node:assert/strict';
import { cli } from './helpers/cli.mjs';
import { securitySite, hostedServices, listen } from './helpers/sites.mjs';
import { scoreFindings } from '../src/security/score.mjs';
import { redactSecrets } from '../src/security/secrets.mjs';

test('a dirty app fails with every defect named', async () => {
  const site = await securitySite({ dirty: true });
  try {
    const r = await cli(['security', site.url, '--owner-confirmed', '--supabase-url', site.url, '--json']);
    assert.equal(r.code, 1);
    const ids = r.json.findings.map((f) => f.id);
    for (const id of [
      'supabase-service-role-key',
      'supabase-jwt-signing-secret',
      'open-rest-tables',
      'missing-hsts',
      'missing-csp',
      'client-side-admin-flag',
      'jwt-in-localstorage',
      'stripe-webhook-accepts-unsigned',
      'stripe-webhook-accepts-bad-signature',
    ]) {
      assert.ok(ids.includes(id), `expected ${id} in ${ids.join(', ')}`);
    }
    assert.equal(r.json.data.grade, 'F');
    assert.match(r.json.notes.join(' '), /cross-tenant probe did not run here/);
    for (const f of r.json.findings) assert.doesNotMatch(JSON.stringify(f), /eyJ[A-Za-z0-9_-]{30,}/, 'a key is never printed whole');
  } finally {
    await site.close();
  }
});

test('a clean app passes with grade A and states the passes', async () => {
  const site = await securitySite({ dirty: false });
  try {
    const r = await cli(['security', site.url, '--owner-confirmed', '--supabase-url', site.url, '--json']);
    assert.equal(r.code, 0);
    assert.equal(r.json.data.grade, 'A');
    const ids = r.json.findings.map((f) => f.id);
    assert.ok(ids.includes('jwt-signing-secret-absent'), 'the signing-secret check says it ran');
    assert.ok(ids.includes('stripe-webhook-rejects-unsigned'));
  } finally {
    await site.close();
  }
});

test('without --owner-confirmed nothing is fetched and the exit is 2', async () => {
  let hits = 0;
  const site = await listen((req, res) => {
    hits++;
    res.end('ok');
  });
  try {
    const r = await cli(['security', site.url]);
    assert.equal(r.code, 2);
    assert.match(r.out, /--owner-confirmed/);
    assert.equal(hits, 0);
  } finally {
    await site.close();
  }
});

test('an unreachable host is exit 2 and gets no score', async () => {
  const r = await cli(['security', 'http://127.0.0.1:9/', '--owner-confirmed', '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json.data.score, undefined);
});

test('--min-grade fails a scan graded below it', async () => {
  const site = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>x</title><h1>Plain page with no security headers</h1>');
  });
  try {
    const loose = await cli(['security', site.url, '--owner-confirmed', '--json']);
    assert.equal(loose.code, 0, 'medium and low findings alone do not fail');
    const strict = await cli(['security', site.url, '--owner-confirmed', '--min-grade', 'A', '--json']);
    assert.equal(strict.code, 1);
    assert.ok(strict.json.findings.some((f) => f.id === 'grade-below-floor'));
    assert.equal((await cli(['security', site.url, '--owner-confirmed', '--min-grade', 'Z'])).code, 2);
  } finally {
    await site.close();
  }
});

test('--hosted adds the cross-tenant probe and fails on it', async () => {
  const site = await securitySite({ dirty: false });
  const hosted = await hostedServices();
  try {
    const r = await cli(['security', site.url, '--owner-confirmed', '--supabase-url', site.url, '--hosted', '--json'], { env: { SHIPPROBE_BREACHPROBE_URL: hosted.url } });
    assert.equal(r.code, 1);
    assert.ok(r.json.findings.some((f) => f.id === 'rls-cross-tenant' && f.hosted));
    assert.equal(r.json.data.hosted.reportUrl, `${hosted.url}/report/scan-1`);
    assert.deepEqual(hosted.calls[0].body, { url: `${site.url}/`, ownerConfirmed: true });
  } finally {
    await site.close();
    await hosted.close();
  }
});

test('a hosted call that fails is exit 2, never folded into a pass', async () => {
  const site = await securitySite({ dirty: false });
  try {
    const r = await cli(['security', site.url, '--owner-confirmed', '--supabase-url', site.url, '--hosted'], { env: { SHIPPROBE_BREACHPROBE_URL: 'http://127.0.0.1:9' } });
    assert.equal(r.code, 2);
  } finally {
    await site.close();
  }
});

test('the score caps the grade at F on a critical and at C on a high', () => {
  assert.equal(scoreFindings([{ severity: 'critical' }]).grade, 'F');
  assert.equal(scoreFindings([{ severity: 'high' }]).grade, 'C');
  assert.equal(scoreFindings([]).score, 100);
});

test('redactSecrets hides credential-shaped strings before they leave the machine', () => {
  const key = ['sk', 'live', 'z'.repeat(24)].join('_');
  const out = redactSecrets(`const k = "${key}";`);
  assert.doesNotMatch(out, new RegExp(key));
  assert.match(out, /redacted stripe-secret-key/);
});
