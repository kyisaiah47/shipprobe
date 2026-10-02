/* The shape every command returns, and the one function that prints it.
 *
 * A finding always names the thing and the measurement: which selector or file or header, what
 * number it measured, and what number it needed. "Contrast is low" cannot be acted on. "p.faint
 * measures 2.1:1 against rgb(255,255,255), needs 4.5:1" can be fixed by someone who was not there.
 */
import { PASS, FAIL, UNCHECKED, NEVER, MEANING } from './exit.mjs';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'pass'];

/**
 * @typedef {Object} Finding
 * @property {string} id         stable slug
 * @property {string} severity   critical | high | medium | low | pass
 * @property {string} title      one line
 * @property {string} [detail]   what was measured
 * @property {string} [where]    selector, file, header or URL
 * @property {number} [line]     a line in a file, when one can be honestly named
 * @property {boolean} [failing] whether this finding fails the run
 */

/** A blank result for a command. Runners fill it in and set `code`. */
export function newResult(command, subject) {
  return {
    tool: 'shipprobe',
    command,
    subject,
    code: UNCHECKED,
    summary: '',
    findings: [],
    warnings: [],
    notes: [],
    unchecked: [],
    data: {},
    startedAt: new Date().toISOString(),
  };
}

export function failingFindings(result) {
  return result.findings.filter((f) => f.failing);
}

const MARK = { critical: 'X', high: 'X', medium: '!', low: '.', pass: 'ok' };

function wrap(s, width = 96) {
  const out = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + w.length > width) {
        out.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

/** Plain text, for a terminal. Each command may print its own header first. */
export function printResult(result, { log = console.log, quiet = false } = {}) {
  log(`\nshipprobe ${result.command}  ${result.subject ?? ''}`.trimEnd());
  if (result.summary) for (const l of wrap(result.summary)) log(`  ${l}`);

  const shown = quiet ? result.findings.filter((f) => f.failing) : result.findings;
  if (shown.length) log('');
  for (const f of shown) {
    const tag = f.failing ? 'FAIL' : f.severity === 'pass' ? 'pass' : 'info';
    log(`  ${tag.padEnd(4)} ${MARK[f.severity] ?? '-'} [${f.severity}] ${f.title}`);
    if (f.where) log(`         at ${f.where}${f.line ? `:${f.line}` : ''}`);
    if (f.detail) for (const l of wrap(f.detail, 90)) log(`         ${l}`);
  }

  if (!quiet && result.warnings.length) {
    log('');
    for (const w of result.warnings) {
      log(`  warn ${w.title}`);
      if (w.where) log(`       at ${w.where}`);
      if (w.detail) for (const l of wrap(w.detail, 90)) log(`       ${l}`);
    }
  }

  if (!quiet && result.notes.length) {
    log('');
    for (const n of result.notes) for (const l of wrap(`note: ${n}`, 94)) log(`  ${l}`);
  }

  if (result.unchecked.length) {
    log('');
    log('  COULD NOT CHECK. This run is not a verdict, and could-not-check is never reported as clean.');
    for (const u of result.unchecked) for (const l of wrap(`${u.where ? `${u.where}: ` : ''}${u.why}`, 90)) log(`    ${l}`);
  }

  log('');
  log(`  exit ${result.code}: ${MEANING[result.code] ?? 'unknown'}`);
  if (result.code === FAIL || result.code === NEVER) {
    log('  There is no --force, no allowlist and no known-issues file. Fix the subject, or change the rule in the open.');
  }
  return result.code;
}

export { PASS, FAIL, UNCHECKED, NEVER };
