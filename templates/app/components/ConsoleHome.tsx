'use client';

import Mark from './Mark';
import Findings from './Findings';
import { useChecks } from './CheckState';

/* Console: every check on one screen, findings as tables. */
export default function ConsoleHome() {
  const { slot, setDraft, run } = useChecks();
  const sec = slot('security');
  const dep = slot('deps');
  const agt = slot('agents-md');
  return (
    <div className="page page-console">
      <header className="top">
        <Mark />
        <nav aria-label="Checks">
          <a href="#security">Security</a>
          <a href="#deps">Package</a>
          <a href="#agents-md">Agent file</a>
        </nav>
      </header>
      <main className="console-grid">
        <section id="security" className="panel" aria-labelledby="security-h">
          <h2 id="security-h">Security scan</h2>
          <p className="panel-lede">Keys in the shipped code, readable database tables, security headers, insecure patterns and payment routes.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('security');
            }}
          >
            <label htmlFor="c-url">Deployed URL</label>
            <input id="c-url" type="url" required placeholder="https://your-app.example" value={String(sec.draft.url ?? '')} onChange={(e) => setDraft('security', { url: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={sec.draft.ownerConfirmed === true} onChange={(e) => setDraft('security', { ownerConfirmed: e.target.checked })} />
              I own this app or am authorised to scan it
            </label>
            <button type="submit" disabled={sec.running}>{sec.running ? 'Scanning' : 'Scan'}</button>
          </form>
          {sec.result ? <Findings result={sec.result} dense /> : null}
        </section>

        <section id="deps" className="panel" aria-labelledby="deps-h">
          <h2 id="deps-h">Package</h2>
          <p className="panel-lede">What an npm package runs when it installs, and whether its publishing account changed.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('deps');
            }}
          >
            <label htmlFor="c-pkg">npm package</label>
            <input id="c-pkg" required placeholder="left-pad or sharp@0.33.5" value={String(dep.draft.name ?? '')} onChange={(e) => setDraft('deps', { name: e.target.value })} />
            <button type="submit" disabled={dep.running}>{dep.running ? 'Checking' : 'Check'}</button>
          </form>
          {dep.result ? <Findings result={dep.result} dense /> : null}
        </section>

        <section id="agents-md" className="panel" aria-labelledby="agents-h">
          <h2 id="agents-h">Agent file</h2>
          <p className="panel-lede">Scores an AGENTS.md, CLAUDE.md or similar file on length, headings, runnable commands, topics and prohibitions.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('agents-md');
            }}
          >
            <label htmlFor="c-path">File name</label>
            <input id="c-path" value={String(agt.draft.path ?? 'AGENTS.md')} onChange={(e) => setDraft('agents-md', { path: e.target.value })} />
            <label htmlFor="c-content">File contents</label>
            <textarea id="c-content" rows={8} required value={String(agt.draft.content ?? '')} onChange={(e) => setDraft('agents-md', { content: e.target.value })} />
            <button type="submit" disabled={agt.running}>{agt.running ? 'Scoring' : 'Score'}</button>
          </form>
          {agt.result ? <Findings result={agt.result} dense /> : null}
        </section>
      </main>
    </div>
  );
}
