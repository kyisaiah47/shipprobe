import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, cleanEnv } from './helpers/cli.mjs';

/* The worked example documents an exit code for every command. If one drifts, the README is
 * wrong, and this test is where that shows first. */
test('every command in the worked example gives its documented exit code', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'examples', 'run.mjs')], { encoding: 'utf8', env: cleanEnv(), timeout: 600000 });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-4000));
  assert.match(r.stdout, /Every command gave the exit code/);
});

test('shipprobe demo runs the same example', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'shipprobe.mjs'), 'demo'], { encoding: 'utf8', env: cleanEnv(), timeout: 600000 });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-4000));
});
