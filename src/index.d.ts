/** 0 pass, 1 fail, 2 could not check, 3 never produced. */
export type ExitCode = 0 | 1 | 2 | 3;
export const PASS: 0;
export const FAIL: 1;
export const UNCHECKED: 2;
export const NEVER: 3;
export function combine(codes: ExitCode[]): ExitCode;
export class CannotCheck extends Error {}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'pass';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  where?: string;
  file?: string;
  line?: number;
  failing?: boolean;
  [key: string]: unknown;
}

export interface Result {
  tool: 'shipprobe';
  command: string;
  subject: string;
  code: ExitCode;
  summary: string;
  findings: Finding[];
  warnings: { title: string; where?: string; detail?: string }[];
  notes: string[];
  unchecked: { where?: string; why: string }[];
  data: Record<string, unknown>;
  startedAt: string;
}

export function runSecurity(url: string, opts?: { ownerConfirmed?: boolean; minGrade?: string; supabaseUrl?: string }): Promise<Result>;
export function securityScan(url: string, opts?: { supabaseUrl?: string }): Promise<Record<string, unknown>>;
export function runDeps(spec: string, opts?: { failOn?: 'low' | 'medium' | 'high' | 'critical' }): Promise<Result>;
export function inspectPackage(spec: string): Promise<Record<string, unknown>>;
export function runAgentsMd(dir?: string, opts?: { threshold?: number | string; perFileThreshold?: number | string }): Result;

export interface Capability {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}
export interface AgentFileScore {
  path: string;
  kind: string | null;
  formatName: string | null;
  quality: number;
  capabilities: Capability[];
  rawPoints: number;
  cappedAt100: boolean;
  mismatch?: { view: number; score: number };
  reasons: { text: string; line: number; located: boolean }[];
  publishable: { ok: boolean; reasons: { text: string; line: number; located: boolean }[] };
  metrics: { words: number; headings: number; codeBlocks: number; commands: number; sectionTags: string[] };
  commands: string[];
  sections: string[];
}
export function scoreAgentFile(path: string, content: string): AgentFileScore;
export function agentFileFormat(path: string): { kind: string; name: string } | null;

export function runPage(
  targets: string[],
  opts?: { only?: string; skip?: string; vw?: string; home?: string; sample?: number | string; accent?: string; settle?: number | string },
): Promise<Result>;
export function runPlan(spec: string, outputDir: string): Result;
export function runPromote(opts?: { repo?: string; url?: string; config?: string }, io?: { log?: (s: string) => void }): Promise<Result>;
export function initConfig(dir?: string): { ok: boolean; message: string };

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'stub';
export const PROVIDERS: ProviderName[];
export interface Provider {
  name: ProviderName;
  model: string;
  complete(input: { system: string; prompt: string; maxTokens?: number }): Promise<string>;
}
export function createProvider(cfg: { provider: ProviderName; model?: string; apiKey?: string | null; baseUrl?: string }): Provider;
export function fixConfig(opts: { provider?: string; model?: string; baseUrl?: string }, env?: Record<string, string | undefined>): Record<string, unknown>;
export function writeFixes(
  result: Result,
  opts: { provider?: string; model?: string; baseUrl?: string; fixOut?: string; repo?: string },
  io?: { log?: (s: string) => void },
): Promise<{ path: string; provider: string; model: string; findings: number }>;

export function printResult(result: Result, io?: { log?: (s: string) => void; quiet?: boolean }): ExitCode;
export function main(argv: string[], io?: { log?: (s: string) => void; err?: (s: string) => void }): Promise<ExitCode>;
