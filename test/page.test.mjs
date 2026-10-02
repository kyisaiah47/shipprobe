/* The page rules against fixtures. Each PASS fixture is a case a rule once reported on a page that
 * renders correctly; each FAIL fixture is the defect the rule exists for. A rule that fires on a
 * PASS fixture has fabricated a finding, which costs more than the defect it was written for. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';
import { resolveChromium } from '../src/page/browser.mjs';
import { CannotCheck } from '../src/exit.mjs';

const P = (n) => path.join(FIX, 'page', `${n}.html`);
const page = (name, ...args) => cli(['page', P(name), '--settle', '150', '--json', ...args]);
const rules = (r) => new Set(r.json.findings.map((f) => f.id));

const MATRIX = [
  ['contrast-guards', 'contrast', 0, 'every guard clears: a photo sibling, a blend, a slotted node, a sprite, a motif, a grid guide'],
  ['contrast-fail', 'contrast', 1, 'an invisible mark and a collapsed duotone'],
  ['arbiter', 'contrast', 0, 'white text over a dark sibling picture passes on the pixels'],
  ['figure-band', 'figure', 0, 'a thin landscape band'],
  ['figure-capture', 'figure', 0, 'a capture dense enough to study'],
  ['figure-hero', 'figure', 0, 'a background cover'],
  ['figure-twocol', 'figure', 0, 'one column of two with prose beside it'],
  ['figure-tile', 'figure', 0, 'a tile in a scrolling row'],
  ['figure-render', 'figure', 1, 'a render at the full measure'],
  ['figure-tall', 'figure', 1, 'dense but too tall to study in one screen'],
  ['figure-exactcol', 'figure', 1, 'a picture that exactly fills its column'],
  ['dirty', 'dead-column', 1, 'prose stopping at half the measure'],
  ['dirty', 'numeral-label', 1, 'a dominant numeral over a tracked caption'],
  ['dirty', 'table-shape', 1, 'a sentence label and a spanning row'],
  ['dirty', 'noise', 1, 'copy that fits any other product'],
  ['dirty', 'page-chrome', 1, 'no nav, no footer, no way home'],
  ['visible', 'visible', 1, 'a headline at opacity 0.001'],
  ['clipped', 'clipped', 1, 'text cut by an overflow:hidden box'],
  ['nested', 'nested', 1, 'a scroll region the wheel never reaches'],
];

for (const [fixture, rule, want, what] of MATRIX) {
  test(`${rule} on ${fixture}: ${what} (exit ${want})`, async () => {
    const r = await page(fixture, '--only', rule);
    assert.equal(r.code, want, r.out.slice(0, 3000));
  });
}

test('the clean page passes every default rule', async () => {
  const r = await page('clean');
  assert.equal(r.code, 0, r.out.slice(0, 3000));
  assert.ok(r.json.data.rules.includes('nested') && r.json.data.rules.includes('contrast'));
});

test('the dirty page fails, and the merged contrast check confirms the grey paragraph on real pixels', async () => {
  const r = await page('dirty');
  assert.equal(r.code, 1);
  const contrast = r.json.findings.find((f) => f.id === 'contrast');
  assert.ok(contrast, 'contrast fires');
  assert.match(contrast.title, /against the pixels painted behind it/);
});

test('the ladder finds overflow, a wrapped label and a headline below the fold', async () => {
  const r = await page('ladder', '--only', 'overflow,wrap,fold');
  assert.equal(r.code, 1);
  const ids = rules(r);
  for (const id of ['overflow', 'wrap', 'fold']) assert.ok(ids.has(id), `${id} in ${[...ids].join(', ')}`);
});

test('a declared watermark and a declared clamp are not reported', async () => {
  const v = await page('visible', '--only', 'visible');
  assert.ok(!JSON.stringify(v.json.findings).includes('WATERMARK'));
  const c = await page('clipped', '--only', 'clipped');
  assert.equal(c.json.findings.length, 1, JSON.stringify(c.json.findings));
});

test('primary runs only with --accent, and fails on two accent fills on one screen', async () => {
  assert.equal((await page('primary', '--only', 'primary')).code, 2);
  const r = await page('primary', '--only', 'primary', '--accent', '--accent');
  assert.equal(r.code, 1);
  assert.ok(!JSON.stringify(r.json.findings).includes('Monthly'), 'a pressed toggle is not a primary action');
});

test('a page that rendered nothing is exit 2, never a pass', async () => {
  const r = await page('blank', '--only', 'contrast');
  assert.equal(r.code, 2);
});

test('an unknown rule name is exit 2', async () => {
  assert.equal((await page('clean', '--only', 'contrst')).code, 2);
});

test('a missing file is exit 2', async () => {
  assert.equal((await cli(['page', path.join(FIX, 'page', 'nope.html')])).code, 2);
});

test('no Playwright is CannotCheck, not a pass', () => {
  assert.throws(() => resolveChromium([() => { throw new Error('not installed'); }]), CannotCheck);
});
