/* Run the CLI the way a user does: a child process, its exit code and its output.
 *
 * The child gets a CLEAN environment built from a short list of names. Nothing else from the
 * parent reaches it, so a model key that happens to be set on the machine running the tests can
 * never be read by a test, and no test can spend one. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BIN = path.join(ROOT, 'bin', 'shipprobe.mjs');
export const FIX = path.join(ROOT, 'test', 'fixtures');

const PASS_THROUGH = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'CI', 'SHIPPROBE_PLAYWRIGHT', 'PLAYWRIGHT_BROWSERS_PATH', 'SystemRoot'];

export function cleanEnv(extra = {}) {
  const env = {};
  for (const k of PASS_THROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

export function cli(args, { env = {}, cwd = ROOT, timeout = 240000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: cleanEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', (code) => {
      clearTimeout(t);
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* not a --json run */
      }
      resolve({ code, stdout, stderr, out: stdout + stderr, json });
    });
  });
}
