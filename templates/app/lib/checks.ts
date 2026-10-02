/* The three checks this app runs, and the one shape every result comes back in. The shape is
 * ShipProbe's own result object, so what the page shows is what the CLI prints. */

export type CheckKind = 'security' | 'deps' | 'agents-md';

export type Finding = {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'pass';
  title: string;
  detail?: string;
  where?: string;
  line?: number;
  failing?: boolean;
};

export type CheckResult = {
  command: string;
  subject: string;
  code: 0 | 1 | 2 | 3;
  summary: string;
  findings: Finding[];
  notes: string[];
  unchecked: { where?: string; why: string }[];
  data: Record<string, unknown>;
};

export const EXIT_MEANING: Record<number, string> = {
  0: 'Checked, and nothing failed.',
  1: 'Checked, and something failed.',
  2: 'Could not check. That is not a pass.',
  3: 'Checked, and the thing was never produced.',
};

export async function runCheck(kind: CheckKind, body: Record<string, unknown>): Promise<CheckResult> {
  const res = await fetch('/api/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, ...body }),
  });
  const json = await res.json().catch(() => null);
  if (!json || typeof json.code !== 'number') {
    return {
      command: kind,
      subject: '',
      code: 2,
      summary: json?.error || `The server answered HTTP ${res.status}.`,
      findings: [],
      notes: [],
      unchecked: [{ why: json?.error || `HTTP ${res.status}` }],
      data: {},
    };
  }
  return json as CheckResult;
}
