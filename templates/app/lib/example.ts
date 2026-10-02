import fs from 'node:fs';
import path from 'node:path';
import { scoreAgentFile } from 'shipprobe';

/* The labelled example on the Simple page is a real result, never an invented one: ShipProbe
 * scores this app's own AGENTS.md on the server when the page renders. */
export function exampleScore() {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), 'AGENTS.md'), 'utf8');
    const s = scoreAgentFile('AGENTS.md', text);
    return {
      path: 'AGENTS.md',
      quality: s.quality,
      capabilities: s.capabilities.map((c) => ({ label: c.label, points: c.points, max: c.max, detail: c.detail })),
      reasons: s.reasons.map((r) => r.text),
    };
  } catch {
    return null;
  }
}

export type Example = ReturnType<typeof exampleScore>;
