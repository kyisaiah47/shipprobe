/* The library. Everything the CLI does is available here, and every runner returns the same result
 * shape: { command, subject, code, summary, findings, warnings, notes, unchecked, data }.
 *
 *   import { runSecurity, runDeps, runAgentsMd, runPage, runPlan, runPromote } from 'shipprobe';
 *   const r = await runDeps('left-pad');
 *   process.exit(r.code);
 */
export { runSecurity, scan as securityScan } from './security/index.mjs';
export { runDeps, inspect as inspectPackage } from './deps/index.mjs';
export { runAgentsMd, scoreFile as scoreAgentFile, formatFor as agentFileFormat } from './agents-md/index.mjs';
export { runPage } from './page/index.mjs';
export { runPlan } from './plan/index.mjs';
export { runPromote, initConfig } from './promote/index.mjs';
export { createProvider, PROVIDERS } from './fix/providers.mjs';
export { writeFixes, fixConfig } from './fix/index.mjs';
export { PASS, FAIL, UNCHECKED, NEVER, combine, CannotCheck } from './exit.mjs';
export { printResult } from './result.mjs';
export { main } from './cli.mjs';
