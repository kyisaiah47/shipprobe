import test from 'node:test';
import assert from 'node:assert/strict';
import { cli } from './helpers/cli.mjs';
import { combine, PASS, FAIL, UNCHECKED, NEVER } from '../src/exit.mjs';

test('exit codes combine with 2 over 1 over 3 over 0', () => {
  assert.equal(combine([PASS, FAIL, UNCHECKED]), UNCHECKED);
  assert.equal(combine([PASS, FAIL, NEVER]), FAIL);
  assert.equal(combine([PASS, NEVER]), NEVER);
  assert.equal(combine([PASS, PASS]), PASS);
  assert.equal(combine([]), UNCHECKED, 'zero checks run is not a pass');
});

test('no command prints usage and exits 2', async () => {
  const r = await cli([]);
  assert.equal(r.code, 2);
  assert.match(r.out, /shipprobe security/);
});

test('--help exits 0 and names every command', async () => {
  const r = await cli(['--help']);
  assert.equal(r.code, 0);
  for (const c of ['security', 'deps', 'agents-md', 'page', 'plan', 'promote']) assert.match(r.out, new RegExp(`shipprobe ${c}`));
});

test('--version prints the package version', async () => {
  const r = await cli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('an unknown command is exit 2', async () => {
  assert.equal((await cli(['nonsense'])).code, 2);
});

test('an unknown flag is exit 2, never silently ignored', async () => {
  const r = await cli(['plan', 'a.json', 'b', '--forse']);
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown flag --forse/);
});

test('there is no --force flag on any command', async () => {
  for (const c of ['security', 'deps', 'agents-md', 'page', 'plan', 'promote']) {
    const r = await cli([c, '--force']);
    assert.equal(r.code, 2, `${c} --force must be refused`);
    assert.match(r.out, /unknown flag --force/);
  }
});

test('--hosted on a command with no hosted extra is exit 2', async () => {
  const r = await cli(['plan', 'a.json', 'b', '--hosted']);
  assert.equal(r.code, 2);
  assert.match(r.out, /no hosted extra/);
});

test('--fix with no model configured is exit 2 before anything is checked', async () => {
  const r = await cli(['agents-md', 'test/fixtures/agents/good', '--fix']);
  assert.equal(r.code, 2);
  assert.match(r.out, /--fix needs a model/);
  assert.doesNotMatch(r.out, /scores \d+\/100/);
});

test('rules lists every page rule', async () => {
  const r = await cli(['rules']);
  assert.equal(r.code, 0);
  for (const id of ['contrast', 'visible', 'clipped', 'overflow', 'wrap', 'fold', 'nested', 'primary', 'dead-column', 'page-chrome', 'figure', 'table-shape', 'noise']) {
    assert.match(r.out, new RegExp(`\\b${id}\\b`));
  }
});
