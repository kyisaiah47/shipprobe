#!/usr/bin/env node
/* The whole suite: every test/*.test.mjs under node's own test runner, in a clean environment.
 *
 *   node test/run.mjs            everything
 *   node test/run.mjs page plan  only the files whose names contain one of these words
 *
 * The page tests need Playwright and Chromium. Without them those tests fail rather than skip,
 * because a skipped browser test reads exactly like a passing one. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanEnv } from './helpers/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const files = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filters.length || filters.some((w) => f.includes(w)))
  .sort()
  .map((f) => path.join(HERE, f));
if (!files.length) {
  console.error('no test files matched');
  process.exit(2);
}
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], { stdio: 'inherit', env: cleanEnv() });
process.exit(r.status ?? 2);
