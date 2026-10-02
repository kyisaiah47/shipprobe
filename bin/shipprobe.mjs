#!/usr/bin/env node
/* shipprobe. The entry point; everything happens in src/cli.mjs. A crash that produces no code is
 * exit 2, could not check, never the 0 a nullish default would hand back. */
import { main } from '../src/cli.mjs';

main(process.argv.slice(2))
  .then((code) => process.exit(Number.isInteger(code) ? code : 2))
  .catch((e) => {
    console.error(`shipprobe crashed: ${e?.stack || e}`);
    process.exit(2);
  });
