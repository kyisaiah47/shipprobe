import { runSecurity, runDeps, scoreAgentFile, agentFileFormat } from 'shipprobe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* One route for the three checks. Every input is validated here, because this route makes the
 * server fetch things: a package name must be a registry name (never a path on this server), a
 * URL must be http(s) on a public host, and a pasted file must be a format ShipProbe recognises.
 *
 * A server that fetches any URL it is handed can be pointed at its own private network. Literal
 * private and loopback addresses are refused unless SHIPPROBE_ALLOW_PRIVATE=1. A public hostname
 * that resolves to a private address is not caught here; run the app behind an egress proxy if
 * that matters for your deployment. */
const NAME = /^(@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*(@[A-Za-z0-9._^~<>=-]+)?$/;
const LOCAL = /^(localhost|[^.]+\.local|[^.]+\.internal|[^.]+\.localdomain)$/i;

function privateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (LOCAL.test(h) || h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('The body must be JSON.');
  }

  if (body.kind === 'security') {
    let url: URL;
    try {
      url = new URL(String(body.url || '').trim());
    } catch {
      return bad('Enter a full URL, starting with https://');
    }
    if (!/^https?:$/.test(url.protocol)) return bad('Only http and https URLs can be scanned.');
    if (privateHost(url.hostname) && process.env.SHIPPROBE_ALLOW_PRIVATE !== '1') return bad('That is not a public host.');
    return Response.json(await runSecurity(url.toString(), { ownerConfirmed: body.ownerConfirmed === true }));
  }

  if (body.kind === 'deps') {
    const name = String(body.name || '').trim().toLowerCase();
    if (!NAME.test(name)) return bad('Enter an npm package name, with an optional @version.');
    return Response.json(await runDeps(name));
  }

  if (body.kind === 'agents-md') {
    const file = String(body.path || 'AGENTS.md').trim();
    const content = String(body.content || '');
    if (!agentFileFormat(file)) return bad(`${file} is not an agent-instruction file ShipProbe recognises.`);
    if (!content.trim()) return bad('Paste the file first. An empty file is not a score.');
    if (content.length > 1_000_000) return bad('That file is over one million characters.');
    const s = scoreAgentFile(file, content);
    const passed = s.quality >= 60;
    return Response.json({
      command: 'agents-md',
      subject: file,
      code: passed ? 0 : 1,
      summary: `${file} scores ${s.quality}/100, ${passed ? 'at or above' : 'below'} the threshold of 60.`,
      findings: s.capabilities.map((c) => ({
        id: c.key,
        severity: c.points === c.max ? 'pass' : c.points === 0 ? 'medium' : 'low',
        title: `${c.label}: ${c.points} of ${c.max}`,
        detail: c.detail,
        failing: false,
      })),
      notes: s.reasons.map((r) => r.text),
      unchecked: [],
      data: { score: s.quality },
    });
  }

  return bad('Unknown check. Use security, deps or agents-md.');
}
