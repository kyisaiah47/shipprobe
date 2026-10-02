/* `shipprobe agents-md [dir]`: score a repository's agent-instruction files.
 *
 * An AGENTS.md is the one file in a repository nothing checks. It has no schema, so it always
 * parses. It is prose, so it has no tests. It is read by a machine that will not complain, and the
 * failure is silent: the agent gets a file with no runnable command in it, guesses the build
 * command, guesses wrong, and the author never learns the file taught nothing.
 *
 * Recognised formats: AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc, .cursorrules,
 * .github/copilot-instructions.md and .github/instructions/*.instructions.md, .windsurfrules and
 * .windsurf/rules/*.md, .clinerules and .clinerules/*.md(c).
 *
 * The repository score is the strongest file, which is what RuleStack's badge reports.
 * Exit 1 below --threshold (default 60), or when any file is under --per-file-threshold.
 * Exit 3 when the repository has no instruction file at all: it was never produced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newResult, PASS, FAIL, NEVER } from '../result.mjs';
import { extractCommands, sectionTags, qualityScore } from './classify.mjs';

export const FORMATS = [
  { kind: 'agents_md', name: 'AGENTS.md', tests: [/(^|\/)AGENTS\.md$/] },
  { kind: 'claude_md', name: 'CLAUDE.md', tests: [/(^|\/)CLAUDE\.md$/] },
  { kind: 'gemini_md', name: 'GEMINI.md', tests: [/(^|\/)GEMINI\.md$/] },
  { kind: 'cursor_rule', name: 'Cursor rules', tests: [/(^|\/)\.cursor\/rules\/[^/]+\.mdc$/i] },
  { kind: 'cursorrules', name: '.cursorrules', tests: [/(^|\/)\.cursorrules$/] },
  {
    kind: 'copilot_instructions',
    name: 'Copilot instructions',
    tests: [/(^|\/)\.github\/copilot-instructions\.md$/i, /(^|\/)\.github\/instructions\/[^/]+\.instructions\.md$/i],
  },
  { kind: 'windsurf_rules', name: 'Windsurf rules', tests: [/(^|\/)\.windsurfrules$/, /(^|\/)\.windsurf\/rules\/[^/]+\.md$/i] },
  { kind: 'cline_rules', name: 'Cline rules', tests: [/(^|\/)\.clinerules$/, /(^|\/)\.clinerules\/[^/]+\.mdc?$/i] },
];

/** Vendored and example noise, never scored. */
export const NOISE = /(^|\/)(node_modules|\.git|vendor|dist|build|\.next|__tests?__|fixtures?|testdata)(\/|$)/i;

export function formatFor(p) {
  if (NOISE.test(p)) return null;
  return FORMATS.find((f) => f.tests.some((t) => t.test(p))) || null;
}

/** C0 controls (apart from tab, newline, carriage return), DEL, and unpaired surrogates. */
function scrub(s) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

const FENCE = /^---\s*$/;
/** Frontmatter is split off; `proseLine1` is the line in the ORIGINAL file the prose starts on, so a
 *  reason lands on the line a reader is looking at. */
function splitFrontmatter(text) {
  const src = text.replace(/^﻿/, '');
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (!FENCE.test(lines[i] ?? '')) return { prose: src, proseLine1: 1 };
  for (let j = i + 1; j < lines.length; j++) if (FENCE.test(lines[j])) return { prose: lines.slice(j + 1).join('\n'), proseLine1: j + 2 };
  return { prose: src, proseLine1: 1 };
}

const words = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);

/* WHERE THE POINTS CAME FROM. A view over qualityScore, never a second implementation: when the
 * two disagree, `mismatch` is set, and that is a defect in this view, not in the score. */
function breakdown(m) {
  const tags = new Set(m.tags);
  const caps = [];
  let pts;
  let detail;
  if (m.words < 40) [pts, detail] = [4, `${m.words} words: barely any content`];
  else if (m.words < 120) [pts, detail] = [16, `${m.words} words: very short`];
  else if (m.words <= 400) [pts, detail] = [30, `${m.words} words`];
  else if (m.words <= 1200) [pts, detail] = [34, `${m.words} words, the band this scorer rates highest`];
  else if (m.words <= 2500) [pts, detail] = [26, `${m.words} words: long, and every one is read on every request`];
  else [pts, detail] = [14, `${m.words} words: past the length most agents will use`];
  caps.push({ key: 'length', label: 'Length', points: pts, max: 34, detail });
  caps.push({
    key: 'structure',
    label: 'Section headings',
    points: m.headings >= 5 ? 14 : m.headings >= 2 ? 9 : 0,
    max: 14,
    detail: m.headings === 0 ? 'no headings' : `${m.headings} heading${m.headings === 1 ? '' : 's'}`,
  });
  const n = m.commands.length;
  caps.push({
    key: 'commands',
    label: 'Runnable commands',
    points: n >= 6 ? 20 : n >= 3 ? 15 : n >= 1 ? 8 : 0,
    max: 20,
    detail: n === 0 ? 'no runnable commands' : `${n} command${n === 1 ? '' : 's'} an agent can execute`,
  });
  const core = ['build', 'test', 'lint-format', 'code-style', 'architecture'];
  const covered = core.filter((t) => tags.has(t));
  caps.push({
    key: 'coverage',
    label: 'Core topic coverage',
    points: Math.min(15, covered.length * 4),
    max: 15,
    detail: covered.length ? `${covered.length} of ${core.length}: ${covered.join(', ')}` : `0 of ${core.length}: none of ${core.join(', ')}`,
  });
  caps.push({
    key: 'prohibitions',
    label: 'Explicit prohibitions',
    points: tags.has('do-not') ? 7 : 0,
    max: 7,
    detail: tags.has('do-not') ? 'the file tells the agent what never to do' : 'nothing the agent is told never to do',
  });
  caps.push({
    key: 'specificity',
    label: "Names this repository's own paths",
    points: m.specific ? 8 : 0,
    max: 8,
    detail: m.specific ? 'the file names real directories' : 'generic: it never names a path in this repository',
  });
  caps.push({
    key: 'examples',
    label: 'Worked examples',
    points: m.codeBlocks > 0 ? 6 : 0,
    max: 6,
    detail: m.codeBlocks > 0 ? `${m.codeBlocks} fenced code block${m.codeBlocks === 1 ? '' : 's'}` : 'no fenced code blocks',
  });
  return caps;
}

/** A line where one can honestly be named. Most reasons are absences, and an absence has no line;
 *  those carry `located: false`. The length overruns can be located: the line where the running
 *  word count first crosses 1,200 or 2,500. */
function locate(reasons, prose, proseLine1) {
  const atBudget = (budget) => {
    const lines = prose.split('\n');
    let running = 0;
    for (let i = 0; i < lines.length; i++) {
      running += words(lines[i]);
      if (running > budget) return proseLine1 + i;
    }
    return null;
  };
  return reasons.map((text) => {
    const budget = text.startsWith('very long,') ? 2500 : text.startsWith('long,') ? 1200 : null;
    const line = budget ? atBudget(budget) : null;
    return line ? { text, line, located: true } : { text, line: 1, located: false };
  });
}

/** Score one file's content. Exported so the hosted comparison and the app scaffold share it. */
export function scoreFile(filePath, content) {
  const fmt = formatFor(filePath);
  const { prose, proseLine1 } = splitFrontmatter(scrub(String(content)));
  const metrics = {
    words: words(prose),
    headings: (prose.match(/^#{1,6}\s+\S/gm) ?? []).length,
    codeBlocks: (prose.match(/```/g) ?? []).length >> 1,
  };
  const sections = (prose.match(/^#{1,3}\s+(.+)$/gm) ?? []).map((h) => h.replace(/^#+\s*/, '')).slice(0, 60);
  const commands = extractCommands(prose);
  const tags = sectionTags(sections, prose);
  const specific = /(^|\s)(src|app|apps|packages|lib|internal|cmd|tests?)\//m.test(prose);
  const { score, reasons } = qualityScore({
    body: prose,
    body_words: metrics.words,
    body_headings: metrics.headings,
    code_blocks: metrics.codeBlocks,
    commands,
    section_tags: tags,
  });
  const capabilities = breakdown({ ...metrics, commands, tags, specific });
  const rawPoints = capabilities.reduce((a, c) => a + c.points, 0);
  const view = Math.max(0, Math.min(100, Math.round(rawPoints)));
  const publishReasons = [];
  if (metrics.words < 30) publishReasons.push({ text: 'under 30 words', line: 1, located: false });
  if (/^(\s*<!--)?\s*(TODO|TBD|placeholder|coming soon)/i.test(prose.trim())) {
    publishReasons.push({ text: 'placeholder content', line: prose.slice(0, prose.length - prose.trimStart().length).split('\n').length, located: true });
  }
  return {
    path: filePath,
    kind: fmt?.kind ?? null,
    formatName: fmt?.name ?? null,
    quality: score,
    capabilities,
    rawPoints,
    cappedAt100: rawPoints > 100,
    ...(view === score ? {} : { mismatch: { view, score } }),
    reasons: locate(reasons, prose, proseLine1),
    publishable: { ok: !publishReasons.length, reasons: publishReasons },
    metrics: { ...metrics, commands: commands.length, sectionTags: tags },
    commands,
    sections,
  };
}

const SKIP_DIR = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'testdata']);

function walk(root, rel = '', out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(root, p, out, depth + 1);
    } else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Tracked paths from git when the directory is a checkout root, else a walk. A directory inside
 *  a larger checkout is walked, so its paths are relative to the directory that was asked about. */
export function candidatePaths(dir) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(top) === path.resolve(dir)) {
      const list = execFileSync('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\0')
        .filter(Boolean);
      if (list.length) return list;
    }
  } catch {
    /* not a git checkout, or no git. Walk instead. */
  }
  return walk(dir);
}

export function runAgentsMd(dir = '.', opts = {}) {
  const root = path.resolve(dir || '.');
  const result = newResult('agents-md', root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    result.unchecked.push({ where: dir, why: 'not a directory' });
    return result;
  }
  const num = (v, name, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${name} "${v}" is not a number from 0 to 100`);
    return n;
  };
  let threshold;
  let perFile;
  try {
    threshold = num(opts.threshold, '--threshold', 60);
    perFile = num(opts.perFileThreshold, '--per-file-threshold', null);
  } catch (e) {
    result.unchecked.push({ why: e.message });
    return result;
  }

  const files = [];
  for (const p of candidatePaths(root)) {
    if (!formatFor(p)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(root, p), 'utf8');
    } catch (e) {
      result.unchecked.push({ where: p, why: `matched but could not be read: ${e.message}` });
      return result;
    }
    files.push(scoreFile(p, content));
  }

  if (!files.length) {
    result.code = NEVER;
    result.summary =
      'No agent-instruction file in this repository. Nothing tells a coding agent how to build it, test it, or what never to touch. ' +
      `Recognised: ${FORMATS.map((f) => f.name).join(', ')}.`;
    result.findings.push({
      id: 'no-instruction-file',
      severity: 'high',
      title: 'No agent-instruction file',
      detail: 'Add one at the repository root. AGENTS.md is read by the most agents.',
      failing: true,
      absent: true,
    });
    result.data = { score: null, files: [] };
    return result;
  }

  files.sort((a, b) => b.quality - a.quality || a.path.localeCompare(b.path));
  const best = files[0];
  for (const f of files) {
    const belowRepo = f === best && best.quality < threshold;
    const belowFile = perFile !== null && f.quality < perFile;
    const failing = belowRepo || belowFile;
    result.findings.push({
      id: 'file-score',
      severity: failing ? 'high' : f.quality >= 80 ? 'pass' : 'low',
      title: `${f.path} scores ${f.quality}/100 (${f.formatName})`,
      detail:
        f.capabilities.map((c) => `${c.label} ${c.points}/${c.max} (${c.detail})`).join('; ') +
        (f.reasons.length ? `. Flagged: ${f.reasons.map((r) => r.text + (r.located ? ` at line ${r.line}` : '')).join('; ')}.` : '.'),
      where: f.path,
      file: path.relative(process.cwd(), path.join(root, f.path)) || f.path,
      line: f.reasons.find((r) => r.located)?.line,
      failing,
    });
    for (const r of f.publishable.reasons) {
      result.findings.push({ id: 'not-publishable', severity: 'medium', title: `${f.path}: ${r.text}`, where: f.path, line: r.line, failing: false });
    }
    if (f.mismatch) result.warnings.push({ title: `${f.path}: the breakdown sums to ${f.mismatch.view} and the score is ${f.mismatch.score}`, detail: 'This is a defect in the breakdown view, not in the score.' });
  }
  result.data = { score: best.quality, bestFile: best.path, threshold, perFileThreshold: perFile, files };
  result.summary = `${files.length} agent-instruction file${files.length === 1 ? '' : 's'}. The repository scores ${best.quality}/100 (strongest file ${best.path}), ${best.quality >= threshold ? 'at or above' : 'below'} the threshold of ${threshold}.`;
  result.code = result.findings.some((f) => f.failing) ? FAIL : PASS;
  return result;
}
