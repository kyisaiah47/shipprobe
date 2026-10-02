import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, cleanEnv } from './helpers/cli.mjs';

const gate = path.join(ROOT, 'scripts', 'scrub-gate.mjs');

test('every scrub rule fires on its generated fixture, and the gate passes its own scan', () => {
  const r = spawnSync(process.execPath, [gate, '--self-test'], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('this repository is clean', () => {
  const r = spawnSync(process.execPath, [gate, ROOT], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
