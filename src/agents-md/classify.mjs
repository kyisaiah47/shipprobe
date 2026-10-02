/* What is actually IN an agent-instruction file, measured from the text alone with no model call:
 * which topics it covers, which commands it hands the agent, and whether it is an instruction set
 * or a stub. The same classifier scores the files in RuleStack's gallery, so a score here is the
 * score the gallery shows for the same file. */

export const SECTION_TAGS = [
  { tag: 'setup', label: 'Setup & install', head: /\b(setup|set up|install|getting started|prerequisites|environment|dev environment)\b/i, body: /\b(npm|pnpm|yarn|bun|pip|uv|poetry|cargo|go) (install|add|sync)\b/i },
  { tag: 'build', label: 'Build', head: /\b(build|compile|bundl)/i, body: /\b(npm|pnpm|yarn|bun|make|cargo|go|mvn|gradle) run build\b|\b(cargo|go) build\b/i },
  { tag: 'test', label: 'Tests', head: /\b(test|testing|spec|qa)\b/i, body: /\b(npm|pnpm|yarn|bun) (run )?test\b|\b(pytest|vitest|jest|cargo test|go test)\b/i },
  { tag: 'lint-format', label: 'Lint & format', head: /\b(lint|format|prettier|eslint|biome|ruff|style guide|formatting)\b/i, body: /\b(eslint|prettier|ruff|black|gofmt|rustfmt|biome|clippy)\b/i },
  { tag: 'code-style', label: 'Code style', head: /\b(code style|conventions|style|naming|patterns|idioms|best practices)\b/i, body: /\b(naming convention|prefer|avoid using|do not use)\b/i },
  { tag: 'architecture', label: 'Architecture', head: /\b(architect|structure|layout|directory|project structure|modules|packages|overview|codebase)\b/i, body: /\b(directory structure|the codebase is organi)/i },
  { tag: 'types', label: 'Types', head: /\b(types?|typing|typescript|type safety|schema)\b/i, body: /\b(strict mode|no any\b|type annotation)/i },
  { tag: 'testing-strategy', label: 'Testing strategy', head: /\b(test strategy|testing strategy|coverage|tdd|unit test|integration test|e2e)\b/i, body: /\b(write a (failing )?test first|test coverage|mock|fixture)\b/i },
  { tag: 'git-pr', label: 'Git, commits & PRs', head: /\b(git|commits?|pull requests?|prs?\b|branch|changeset|review|merge)\b/i, body: /\b(conventional commits?|commit messages?|open a pr\b|pull requests?)\b/i },
  { tag: 'security', label: 'Security', head: /\b(security|secrets?|auth|permissions|credentials|vulnerab)/i, body: /\b(never commit (a |any )?(secrets?|api keys?|tokens?|credentials?)|\.env\b|do not log (secrets?|tokens?))/i },
  { tag: 'dependencies', label: 'Dependencies', head: /\b(dependencies|packages|libraries|vendoring|third.?party)\b/i, body: /\b(do not add (new )?dependen|avoid adding dependen|no new dependencies)\b/i },
  { tag: 'database', label: 'Database & migrations', head: /\b(database|db\b|migration|schema|sql|orm|prisma|drizzle)\b/i, body: /\b(run the migration|do not edit (the )?migration)\b/i },
  { tag: 'api', label: 'APIs & contracts', head: /\b(api|endpoint|route|contract|openapi|graphql|rpc)\b/i, body: /\b(api route|endpoint handler|response shape)\b/i },
  { tag: 'ui', label: 'UI & components', head: /\b(ui|component|design system|styling|css|tailwind|accessib|a11y)\b/i, body: /\b(component (should|must)|design token|aria-)\b/i },
  { tag: 'performance', label: 'Performance', head: /\b(performance|perf|optimi[sz]|benchmark|latency|memory)\b/i, body: /\b(avoid (n\+1|re-?render)|hot path|benchmark before)\b/i },
  { tag: 'deployment', label: 'Deploy & release', head: /\b(deploy|release|ship|ci\/cd|pipeline|publish|version)\b/i, body: /\b(deploy to|release process|do not deploy)\b/i },
  { tag: 'monorepo', label: 'Monorepo', head: /\b(monorepo|workspace|packages?\/|apps?\/)\b/i, body: /\b(workspace root|this package only|per-package)\b/i },
  { tag: 'do-not', label: 'Hard prohibitions', head: /\b(do not|don't|never|forbidden|prohibited|avoid|anti.?pattern|rules)\b/i, body: /\b(never (commit|push|run|use|edit)|do not (commit|modify|create|touch))\b/i },
  { tag: 'agent-behaviour', label: 'Agent behaviour', head: /\b(agent|assistant|claude|codex|cursor|copilot|instructions|workflow|how to work)\b/i, body: /\b(before (you|making) (any )?(changes?|edits?)|ask (before|for confirmation)|do not assume)\b/i },
  { tag: 'docs', label: 'Documentation', head: /\b(docs?|documentation|comments|readme|changelog)\b/i, body: /\b(update the (readme|changelog|docs)|jsdoc|docstring)\b/i },
];

/** A line starting with one of these runners is a real instruction. */
const RUNNERS =
  /^(npm|pnpm|yarn|bun|bunx|npx|node|deno|make|just|task|cargo|go|rustc|python3?|uv|uvx|poetry|pip3?|pytest|ruff|black|mypy|tox|rake|bundle|rails|mix|composer|php|artisan|mvn|gradle|\.\/gradlew|dotnet|swift|xcodebuild|flutter|dart|docker|docker-compose|kubectl|helm|terraform|gh|git|tsc|eslint|prettier|biome|vitest|jest|playwright|cypress|turbo|nx|mise|hatch|pdm|zig|cmake|ninja|gleam|elm)\b/;

/** The runnable commands in a file. "run `pnpm test --filter web`" is what an agent acts on. */
export function extractCommands(text, { max = 40 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const cmd = raw.trim().replace(/^[$>]\s*/, '').replace(/\s+#.*$/, '').trim();
    if (cmd.length < 3 || cmd.length > 160 || !RUNNERS.test(cmd) || seen.has(cmd)) return;
    seen.add(cmd);
    out.push(cmd);
  };
  for (const m of text.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)) {
    const isShell = /^(sh|bash|zsh|shell|console|terminal|shellsession|command)$/.test(m[1].toLowerCase());
    for (const line of m[2].split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      if (isShell || RUNNERS.test(t.replace(/^[$>]\s*/, ''))) push(t);
      if (out.length >= max) return out;
    }
  }
  for (const m of text.matchAll(/`([^`\n]{3,120})`/g)) {
    push(m[1]);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export function sectionTags(sections = [], body = '') {
  const heads = sections.join('\n');
  const prose = body.slice(0, 60_000);
  return SECTION_TAGS.filter(({ head, body: b }) => head.test(heads) || (b && b.test(prose))).map((t) => t.tag);
}

/** 0 to 100, about the FILE. A one-line AGENTS.md in a famous repository is still a stub. */
export function qualityScore(c) {
  const reasons = [];
  const words = c.body_words ?? 0;
  let score = 0;
  if (words < 40) {
    score += 4;
    reasons.push('barely any content');
  } else if (words < 120) {
    score += 16;
    reasons.push('very short');
  } else if (words <= 400) score += 30;
  else if (words <= 1200) score += 34;
  else if (words <= 2500) {
    score += 26;
    reasons.push('long, and it costs context on every request');
  } else {
    score += 14;
    reasons.push('very long, and most agents will not use all of it');
  }
  const heads = c.body_headings ?? 0;
  if (heads >= 5) score += 14;
  else if (heads >= 2) score += 9;
  else reasons.push('no section headings');
  const cmds = (c.commands ?? []).length;
  if (cmds >= 6) score += 20;
  else if (cmds >= 3) score += 15;
  else if (cmds >= 1) score += 8;
  else reasons.push('no runnable commands');
  const tags = new Set(c.section_tags ?? []);
  const covered = ['build', 'test', 'lint-format', 'code-style', 'architecture'].filter((t) => tags.has(t));
  score += Math.min(15, covered.length * 4);
  if (!tags.has('test')) reasons.push('says nothing about tests');
  if (!tags.has('build') && !tags.has('setup')) reasons.push('no build or setup instructions');
  if (tags.has('do-not')) score += 7;
  else reasons.push('no explicit prohibitions');
  const specific = /(^|\s)(src|app|apps|packages|lib|internal|cmd|tests?)\//m.test(c.body ?? '');
  if (specific) score += 8;
  else reasons.push('generic: it never names a path in this repository');
  if (c.code_blocks > 0) score += 6;
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
