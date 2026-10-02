/* The provider interface, tested against local stand-ins. No test here talks to a paid model, and
 * no test reads a provider key from the environment: keys are passed in explicitly as dummies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, FIX } from './helpers/cli.mjs';
import { modelServer, listen } from './helpers/sites.mjs';
import { createProvider } from '../src/fix/providers.mjs';
import { fixConfig } from '../src/fix/index.mjs';

const readBody = (req) =>
  new Promise((r) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => r(JSON.parse(s || '{}')));
  });

test('there is no default model and no default provider', () => {
  assert.throws(() => createProvider({ provider: 'openai', apiKey: 'dummy' }), /--model is required/);
  assert.throws(() => createProvider({ provider: 'nope', model: 'm' }), /--provider must be one of/);
  assert.throws(() => createProvider({ provider: 'openai-compatible', model: 'm' }), /--base-url is required/);
  assert.throws(() => createProvider({ provider: 'anthropic', model: 'm' }), /no API key/);
  assert.throws(() => fixConfig({}, {}), /--fix needs a model/);
});

test('the stub provider calls nothing and names each failing finding', async () => {
  const p = createProvider({ provider: 'stub' });
  const out = await p.complete({ system: 's', prompt: '[{"id": "a"}, {"id": "b"}]' });
  assert.match(out, /1\. a/);
  assert.match(out, /2\. b/);
});

test('openai-compatible speaks chat completions to any base URL, including a local model', async () => {
  const m = await modelServer();
  try {
    const p = createProvider({ provider: 'openai-compatible', model: 'local-model', baseUrl: `${m.url}/v1` });
    assert.match(await p.complete({ system: 'sys', prompt: 'hello' }), /security header/);
    assert.equal(m.calls[0].path, '/v1/chat/completions');
    assert.equal(m.calls[0].body.model, 'local-model');
    assert.equal(m.calls[0].auth, null, 'no key is sent when none is configured');
  } finally {
    await m.close();
  }
});

test('the anthropic adapter sends a messages request', async () => {
  let seen;
  const s = await listen(async (req, res) => {
    seen = { path: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body: await readBody(req) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'fix it' }] }));
  });
  try {
    const p = createProvider({ provider: 'anthropic', model: 'some-model', apiKey: 'dummy-key', baseUrl: `${s.url}/v1` });
    assert.equal(await p.complete({ system: 'sys', prompt: 'p' }), 'fix it');
    assert.equal(seen.path, '/v1/messages');
    assert.equal(seen.key, 'dummy-key');
    assert.equal(seen.version, '2023-06-01');
    assert.equal(seen.body.system, 'sys');
    assert.equal(seen.body.messages[0].content, 'p');
  } finally {
    await s.close();
  }
});

test('the gemini adapter sends a generateContent request', async () => {
  let seen;
  const s = await listen(async (req, res) => {
    seen = { path: req.url, key: req.headers['x-goog-api-key'], body: await readBody(req) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'fix it' }] } }] }));
  });
  try {
    const p = createProvider({ provider: 'gemini', model: 'a-flash-model', apiKey: 'dummy-key', baseUrl: `${s.url}/v1beta` });
    assert.equal(await p.complete({ system: 'sys', prompt: 'p' }), 'fix it');
    assert.equal(seen.path, '/v1beta/models/a-flash-model:generateContent');
    assert.equal(seen.body.systemInstruction.parts[0].text, 'sys');
  } finally {
    await s.close();
  }
});

test('the openai adapter surfaces an HTTP error instead of an empty suggestion', async () => {
  const s = await listen((req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    const p = createProvider({ provider: 'openai', model: 'm', apiKey: 'dummy-key', baseUrl: s.url });
    await assert.rejects(p.complete({ system: 's', prompt: 'p' }), /HTTP 401: bad key/);
  } finally {
    await s.close();
  }
});

test('--fix writes suggestions for the repository, and redacts secrets from what it sends', async () => {
  const m = await modelServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-fix-'));
  const planted = ['sk', 'live', 'q'.repeat(24)].join('_');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', config: { key: planted } }));
  fs.writeFileSync(path.join(dir, '.env'), `SECRET=${planted}`);
  fs.cpSync(path.join(FIX, 'agents/stub/AGENTS.md'), path.join(dir, 'AGENTS.md'));
  try {
    const out = path.join(dir, 'fixes.md');
    const r = await cli(['agents-md', dir, '--fix', '--provider', 'openai-compatible', '--model', 'local-model', '--base-url', m.url, '--repo', dir, '--fix-out', out]);
    assert.equal(r.code, 1, 'the check verdict stands');
    const md = fs.readFileSync(out, 'utf8');
    assert.match(md, /openai-compatible `local-model`/);
    assert.match(md, /security header middleware/);
    const prompt = m.calls[0].body.messages[1].content;
    assert.match(prompt, /AGENTS\.md scores \d+\/100/);
    assert.match(prompt, /--- package\.json/);
    assert.ok(!prompt.includes(planted), 'the planted key never leaves the machine');
    assert.ok(!prompt.includes('SECRET='), '.env files are never read');
  } finally {
    await m.close();
  }
});

test('a model call that fails turns the run into exit 2', async () => {
  const r = await cli(['agents-md', path.join(FIX, 'agents/stub'), '--fix', '--provider', 'openai-compatible', '--model', 'm', '--base-url', 'http://127.0.0.1:9', '--fix-out', path.join(os.tmpdir(), 'sp-none.md')]);
  assert.equal(r.code, 2);
  assert.match(r.out, /--fix could not write suggestions/);
});
