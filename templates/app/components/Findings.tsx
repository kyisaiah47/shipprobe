import { EXIT_MEANING, type CheckResult } from '@/lib/checks';

/* One result, in one of two densities. The summary sentence comes first in both. A run that could
 * not check says so in words, and never renders as a clean result. */
export default function Findings({ result, dense = false }: { result: CheckResult; dense?: boolean }) {
  const failing = result.findings.filter((f) => f.failing);
  const rest = result.findings.filter((f) => !f.failing);
  return (
    <div className={dense ? 'result result-dense' : 'result'} data-code={result.code}>
      <p className="result-summary">{result.summary}</p>
      <p className="result-exit">
        Exit {result.code}. {EXIT_MEANING[result.code]}
      </p>
      {result.unchecked.length ? (
        <ul className="result-unchecked">
          {result.unchecked.map((u, i) => (
            <li key={i}>{u.where ? `${u.where}: ` : ''}{u.why}</li>
          ))}
        </ul>
      ) : null}
      {result.findings.length ? (
        dense ? (
          <table className="result-table">
            <thead>
              <tr>
                <th scope="col">Verdict</th>
                <th scope="col">Severity</th>
                <th scope="col">Finding</th>
                <th scope="col">Where</th>
              </tr>
            </thead>
            <tbody>
              {[...failing, ...rest].map((f, i) => (
                <tr key={i} data-failing={f.failing ? 'true' : 'false'}>
                  <td>{f.failing ? 'Fail' : f.severity === 'pass' ? 'Pass' : 'Note'}</td>
                  <td><code>{f.severity}</code></td>
                  <td>
                    <strong>{f.title}</strong>
                    {f.detail ? <span className="result-detail">{f.detail}</span> : null}
                  </td>
                  <td>{f.where ? <code>{f.where}</code> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="result-list">
            {[...failing, ...rest].map((f, i) => (
              <li key={i} data-failing={f.failing ? 'true' : 'false'}>
                <span className="result-verdict">{f.failing ? 'Fail' : f.severity === 'pass' ? 'Pass' : 'Note'}</span>
                <div>
                  <strong>{f.title}</strong>
                  {f.detail ? <p>{f.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {result.notes.length ? (
        <ul className="result-notes">
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
