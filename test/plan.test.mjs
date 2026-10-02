import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';

const P = (n) => path.join(FIX, 'plan', n);

test('output that matches the plan passes', async () => {
  const r = await cli(['plan', P('spec.json'), P('passing')]);
  assert.equal(r.code, 0);
  assert.match(r.out, /5 check\(s\) passed/);
});

test('output that breaks the plan fails, quoting each broken sentence', async () => {
  const r = await cli(['plan', P('spec.json'), P('failing'), '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.json.findings.length, 5);
  const text = JSON.stringify(r.json.findings);
  for (const quote of ['Ship exactly three endpoint pages', 'runnable curl example', 'matching .json schema', 'billing-core', 'sourceCommit']) {
    assert.match(text, new RegExp(quote.replace(/[.]/g, '\\.')));
  }
});

test('a spec ahead of its output exits 3, which is still not a pass', async () => {
  assert.equal((await cli(['plan', P('unbuilt.json'), P('passing')])).code, 3);
});

test('an unknown check kind fails; it is never skipped', async () => {
  const r = await cli(['plan', P('unknown-kind.json'), P('passing')]);
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown check kind "vibes"/);
});

test('a spec that cannot be read, or checks nothing, is exit 2', async () => {
  assert.equal((await cli(['plan', P('broken.json'), P('passing')])).code, 2);
  assert.equal((await cli(['plan', P('empty.json'), P('passing')])).code, 2);
  assert.equal((await cli(['plan', P('nope.json'), P('passing')])).code, 2);
});

test('the output directory is never inferred', async () => {
  const r = await cli(['plan', P('spec.json')]);
  assert.equal(r.code, 2);
  assert.match(r.out, /never inferred/);
});

test('a ** glob reaches every depth, not only the first directory', async () => {
  const r = await cli(['plan', P('deep.json'), P('deep'), '--json']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.json.findings[0].title, /a\/b\/c\/notes\.md contains banned pattern/);
});
