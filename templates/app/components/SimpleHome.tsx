'use client';

import Mark from './Mark';
import Findings from './Findings';
import Disclosure from './site-view/Disclosure';
import { useChecks } from './CheckState';
import type { Example } from '@/lib/example';

/* Simple: one first action, a labelled example, then the other checks behind disclosures. */
export default function SimpleHome({ example }: { example: Example }) {
  const { slot, setDraft, run } = useChecks();
  const sec = slot('security');
  const dep = slot('deps');
  const agt = slot('agents-md');
  return (
    <div className="page page-simple">
      <header className="top">
        <Mark />
        <nav aria-label="Sections">
          <a href="#scan">Scan</a>
          <a href="#example">Example</a>
          <a href="#more">More checks</a>
        </nav>
      </header>
      <main>
        <section className="hero" id="scan">
          <div className="hero-copy">
            <h1>See what your deployed app shows to strangers.</h1>
            <p>
              ShipProbe reads the page and the scripts your app sends to every visitor. It looks for keys that should never ship,
              database tables anyone can read, missing security headers, and payment routes that accept forged requests.
            </p>
            <p className="hero-qualifier">It only reads and sends empty test requests. Scan an app you own or are authorised to scan.</p>
          </div>
          <form
            className="action-card"
            onSubmit={(e) => {
              e.preventDefault();
              run('security');
            }}
          >
            <label htmlFor="s-url">Your app&apos;s URL</label>
            <input id="s-url" type="url" required placeholder="https://your-app.example" value={String(sec.draft.url ?? '')} onChange={(e) => setDraft('security', { url: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={sec.draft.ownerConfirmed === true} onChange={(e) => setDraft('security', { ownerConfirmed: e.target.checked })} />
              I own this app or am authorised to scan it
            </label>
            <button type="submit" disabled={sec.running}>{sec.running ? 'Scanning' : 'Scan my app'}</button>
          </form>
        </section>

        {sec.result ? (
          <section className="band" aria-label="Your scan">
            <Findings result={sec.result} />
          </section>
        ) : null}

        <section className="band" id="example">
          <div className="band-head">
            <p className="label">02 / An example result</p>
            <h2>The score gives you something to act on, not a bare number.</h2>
            <p>Every check names the thing it measured and the number it needed.</p>
          </div>
          {example ? (
            <div className="example-card">
              <p className="example-tag">This example is computed from a file in this app, not from a scan of your site.</p>
              <p className="example-answer">
                This app&apos;s own <code>{example.path}</code> scores {example.quality} out of 100.
              </p>
              <Disclosure title="Score breakdown">
                <ul className="plain">
                  {example.capabilities.map((c) => (
                    <li key={c.label}>
                      {c.label}: {c.points} of {c.max}. {c.detail}.
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          ) : (
            <p>The example could not be computed because this app has no AGENTS.md at its root.</p>
          )}
        </section>

        <section className="band" id="more">
          <div className="band-head">
            <p className="label">03 / Two more checks</p>
            <h2>ShipProbe checks a package before you install it and an agent file before an agent reads it.</h2>
          </div>
          <Disclosure title="Check an npm package">
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                run('deps');
              }}
            >
              <label htmlFor="s-pkg">Package name</label>
              <input id="s-pkg" required placeholder="left-pad or sharp@0.33.5" value={String(dep.draft.name ?? '')} onChange={(e) => setDraft('deps', { name: e.target.value })} />
              <button type="submit" disabled={dep.running}>{dep.running ? 'Checking' : 'Check package'}</button>
            </form>
            {dep.result ? <Findings result={dep.result} /> : null}
          </Disclosure>
          <Disclosure title="Score an AGENTS.md or CLAUDE.md">
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                run('agents-md');
              }}
            >
              <label htmlFor="s-path">File name</label>
              <input id="s-path" value={String(agt.draft.path ?? 'AGENTS.md')} onChange={(e) => setDraft('agents-md', { path: e.target.value })} />
              <label htmlFor="s-content">File contents</label>
              <textarea id="s-content" rows={8} required value={String(agt.draft.content ?? '')} onChange={(e) => setDraft('agents-md', { content: e.target.value })} />
              <button type="submit" disabled={agt.running}>{agt.running ? 'Scoring' : 'Score file'}</button>
            </form>
            {agt.result ? <Findings result={agt.result} /> : null}
          </Disclosure>
        </section>

        <section className="band">
          <div className="band-head">
            <p className="label">04 / Next</p>
            <h2>Run the same checks where you ship.</h2>
          </div>
          <ul className="next-links">
            <li>
              <a href="https://github.com/kyisaiah47/shipprobe#github-action">Add the GitHub Action to a workflow</a>
            </li>
            <li>
              <a href="https://www.npmjs.com/package/shipprobe">Check rendered pages with the CLI</a>
            </li>
            <li>
              <a href="https://shipprobe.thecompound.tech">Read how each check works</a>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
