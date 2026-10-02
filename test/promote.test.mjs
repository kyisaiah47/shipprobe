import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';
import { listen } from './helpers/sites.mjs';

function repo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-promote-'));
  if (config !== undefined) fs.writeFileSync(path.join(dir, 'shipprobe.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

let site;
test.before(async () => {
  site = await listen((req, res) => res.end('ok'));
});
test.after(async () => site.close());

test('no config is exit 2: a repository with no declared gates was not checked', async () => {
  const r = await cli(['promote', '--repo', repo(), '--url', site.url]);
  assert.equal(r.code, 2);
  assert.match(r.out, /shipprobe\s+init/);
});

test('a config with no gates, or invalid JSON, is exit 2', async () => {
  assert.equal((await cli(['promote', '--repo', repo({ gates: [] }), '--url', site.url])).code, 2);
  assert.equal((await cli(['promote', '--repo', repo('{ nope'), '--url', site.url])).code, 2);
});

test('clean gates pass, and {url} reaches each gate', async () => {
  const dir = repo({ gates: [{ name: 'url check', run: ['node', '-e', `process.exit(process.argv[1] === '${site.url}' ? 0 : 1)`, '{url}'] }] });
  const r = await cli(['promote', '--repo', dir, '--url', site.url]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Safe to promote/);
});

test('a failing gate blocks the promote', async () => {
  const dir = repo({ gates: [{ name: 'ok', run: ['node', '-e', 'process.exit(0)'] }, { name: 'bad', run: ['node', '-e', 'process.exit(1)'] }] });
  const r = await cli(['promote', '--repo', dir, '--url', site.url]);
  assert.equal(r.code, 1);
  assert.match(r.out, /Nothing promotes/);
});

test('a missing gate file is a failure, not a skip', async () => {
  const dir = repo({ gates: [{ name: 'moved', run: ['node', 'scripts/gone.mjs'] }] });
  const r = await cli(['promote', '--repo', dir, '--url', site.url]);
  assert.equal(r.code, 1);
  assert.match(r.out, /gate not found/);
});

test('a gate that could not check makes the promote exit 2', async () => {
  const dir = repo({ gates: [{ name: 'blind', run: ['node', '-e', 'process.exit(2)'] }] });
  assert.equal((await cli(['promote', '--repo', dir, '--url', site.url])).code, 2);
});

test('a shipprobe gate runs this copy of ShipProbe', async () => {
  const dir = repo({ gates: [{ name: 'plan', shipprobe: ['plan', path.join(FIX, 'plan/spec.json'), path.join(FIX, 'plan/failing')] }] });
  const r = await cli(['promote', '--repo', dir, '--url', site.url]);
  assert.equal(r.code, 1);
  assert.match(r.out, /The plan says/);
});

test('serve.command starts the build, and the gates run against it', async () => {
  const probe = await listen(() => {});
  const port = probe.port;
  await probe.close();
  const dir = repo({
    serve: { command: ['node', '-e', `require('http').createServer((q,s)=>s.end('up')).listen(${port})`], url: `http://127.0.0.1:${port}`, readyTimeoutMs: 15000 },
    gates: [{ name: 'reach', run: ['node', '-e', "fetch(process.argv[1]).then(r=>r.text()).then(t=>process.exit(t==='up'?0:1))", '{url}'] }],
  });
  const r = await cli(['promote', '--repo', dir]);
  assert.equal(r.code, 0, r.out);
});

test('init writes a config and a spec, and never overwrites', async () => {
  const dir = repo();
  assert.equal((await cli(['init'], { cwd: dir })).code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'shipprobe.json')));
  assert.ok(fs.existsSync(path.join(dir, 'plan.spec.json')));
  assert.equal((await cli(['init'], { cwd: dir })).code, 2);
});
