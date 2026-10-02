import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';
import { hostedServices } from './helpers/sites.mjs';
import { scoreFile, formatFor } from '../src/agents-md/index.mjs';

const A = (n) => path.join(FIX, 'agents', n);

test('a specific, structured AGENTS.md passes and says where its points came from', async () => {
  const r = await cli(['agents-md', A('good'), '--json']);
  assert.equal(r.code, 0);
  assert.ok(r.json.data.score >= 80, `score ${r.json.data.score}`);
  const f = r.json.data.files[0];
  assert.equal(f.capabilities.reduce((a, c) => a + c.points, 0) >= f.quality, true);
  assert.equal(f.mismatch, undefined, 'the breakdown and the score agree');
});

test('a stub fails the default threshold', async () => {
  const r = await cli(['agents-md', A('stub'), '--json']);
  assert.equal(r.code, 1);
  assert.ok(r.json.data.score < 60);
});

test('a repository with no instruction file exits 3: never produced', async () => {
  const r = await cli(['agents-md', A('none')]);
  assert.equal(r.code, 3);
  assert.match(r.out, /No agent-instruction file/);
});

test('thresholds are numbers from 0 to 100, and a bad one is exit 2', async () => {
  assert.equal((await cli(['agents-md', A('good'), '--threshold', '95'])).code, 1);
  assert.equal((await cli(['agents-md', A('stub'), '--threshold', '0'])).code, 0);
  assert.equal((await cli(['agents-md', A('good'), '--threshold', '6O'])).code, 2);
});

test('a Cursor rule with frontmatter is recognised and scored on its prose', async () => {
  const r = await cli(['agents-md', A('cursor'), '--json']);
  assert.equal(r.json.data.files[0].formatName, 'Cursor rules');
  assert.equal(r.json.data.files[0].metrics.words < 20, true, 'the frontmatter is not counted');
});

test('the recogniser skips vendored and fixture paths', () => {
  assert.equal(formatFor('node_modules/x/AGENTS.md'), null);
  assert.equal(formatFor('test/fixtures/AGENTS.md'), null);
  assert.equal(formatFor('AGENTS.md').name, 'AGENTS.md');
  assert.equal(formatFor('.github/copilot-instructions.md').name, 'Copilot instructions');
});

test('a length overrun is located on the line where it happens', () => {
  const body = '# Long\n\n' + Array.from({ length: 300 }, (_, i) => `Line ${i} has a few words in it for the count.`).join('\n');
  const s = scoreFile('AGENTS.md', body);
  const r = s.reasons.find((x) => x.text.startsWith('long,') || x.text.startsWith('very long,'));
  assert.ok(r && r.located && r.line > 3, JSON.stringify(s.reasons));
});

test('--hosted compares the score with RuleStack', async () => {
  const hosted = await hostedServices();
  try {
    const r = await cli(['agents-md', A('good'), '--hosted', '--json'], { env: { SHIPPROBE_RULESTACK_URL: hosted.url } });
    assert.equal(r.code, 0);
    assert.equal(r.json.data.hosted.compared[0].local, r.json.data.hosted.compared[0].hosted);
    assert.equal(hosted.calls[0].body.files[0].content, fs.readFileSync(path.join(A('good'), 'AGENTS.md'), 'utf8'));
  } finally {
    await hosted.close();
  }
});
