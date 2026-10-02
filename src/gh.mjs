/* The GitHub Actions surface, written against the runner's own protocol.
 *
 * There is no `@actions/core` here. That package is many transitive files to write a few strings
 * to stdout and append to two files, and a gate whose install step can fail is a gate an npm outage
 * can skip. Everything below is the documented workflow-command protocol: `::error ...::message`
 * on stdout, markdown appended to GITHUB_STEP_SUMMARY, and `key=value` lines in GITHUB_OUTPUT.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function annotate(level, { file, line, title } = {}, message) {
  const p = Object.entries({ file, line, title })
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${escProp(v)}`)
    .join(',');
  process.stdout.write(`::${level}${p ? ' ' + p : ''}::${escData(message)}${os.EOL}`);
}

/** Append markdown to the job summary. Off a runner it does nothing: the text report already
 *  printed everything the summary holds. */
export function summary(markdown) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  fs.appendFileSync(f, markdown.endsWith('\n') ? markdown : markdown + '\n', 'utf8');
}

export function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  const v = String(value ?? '');
  if (v.includes('\n')) {
    const d = `shipprobe_${crypto.randomBytes(6).toString('hex')}`;
    fs.appendFileSync(f, `${name}<<${d}${os.EOL}${v}${os.EOL}${d}${os.EOL}`, 'utf8');
  } else {
    fs.appendFileSync(f, `${name}=${v}${os.EOL}`, 'utf8');
  }
}

const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Write one result to the runner: annotations, a summary table, outputs and the JSON report. */
export function reportToGitHub(result) {
  for (const f of result.findings) {
    if (f.severity === 'pass') continue;
    const level = f.failing ? 'error' : f.severity === 'critical' || f.severity === 'high' ? 'warning' : 'notice';
    annotate(level, { file: f.file, line: f.line, title: `shipprobe ${result.command}: ${f.title}`.slice(0, 200) },
      [f.detail, f.where ? `at ${f.where}` : ''].filter(Boolean).join(' '));
  }
  for (const u of result.unchecked) annotate('error', { title: `shipprobe ${result.command}: could not check` }, `${u.where ? u.where + ': ' : ''}${u.why}`);

  const rows = result.findings
    .filter((f) => f.severity !== 'pass')
    .map((f) => `| ${f.failing ? 'fail' : 'info'} | ${f.severity} | ${md(f.title)} | ${md(f.where)} |`)
    .join('\n');
  let text = `## shipprobe ${result.command}\n\n\`${md(result.subject)}\`: exit **${result.code}**. ${md(result.summary)}\n\n`;
  if (rows) text += `| Verdict | Severity | Finding | Where |\n| --- | --- | --- | --- |\n${rows}\n\n`;
  if (result.unchecked.length) text += `**Could not check.** ${result.unchecked.map((u) => md(u.why)).join(' ')}\n\n`;
  text += `<sub>ShipProbe is built and used in production by [Compound Labs](https://thecompound.tech).</sub>\n`;
  summary(text);

  const reportPath = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `shipprobe-${result.command}-report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  setOutput('exit-code', String(result.code));
  setOutput('findings', String(result.findings.filter((f) => f.failing).length));
  setOutput('summary', result.summary || '');
  setOutput('report-path', reportPath);
  if (result.data && result.data.score !== undefined && result.data.score !== null) setOutput('score', String(result.data.score));
  if (result.data && result.data.grade) setOutput('grade', String(result.data.grade));
}
