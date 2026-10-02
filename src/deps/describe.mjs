/* A lifecycle script, plus the source of any local file it runs, turned into a plain description.
 * Fixed rules only, no model call: every package runs through the same patterns. */

const NETWORK_CALL = /\b(https?:\/\/[^\s'")]+)|curl\s+|wget\s+|\bfetch\(|axios[.(]|node-fetch|https?\.get\(|https?\.request\(|new\s+XMLHttpRequest|\bdownload\(/i;
const NATIVE_BUILD = /node-gyp\b|prebuild-install|node-pre-gyp|electron-rebuild|napi-build|\bcmake-js\b/i;
const CHILD_PROCESS = /child_process|execSync\(|spawnSync\(|\bspawn\(|\bexec\(/i;
const CHMOD = /\bchmod\b|fs\.chmodSync/i;
const PLATFORM_CHECK = /process\.platform|process\.arch|os\.platform\(/i;

/** `node scripts/postinstall.js [args]` names `scripts/postinstall.js`. */
export function extractInvokedFile(command) {
  const m = command.match(/\bnode\s+(\.?\/?[\w./-]+\.[cm]?js)\b/);
  return m ? m[1].replace(/^\.\//, '') : null;
}

export function describeScript(command, fileContent) {
  const haystack = `${command}\n${fileContent || ''}`;
  const networkReach = NETWORK_CALL.test(haystack);
  const nativeBuild = NATIVE_BUILD.test(haystack);
  const execChild = CHILD_PROCESS.test(haystack) && !nativeBuild;
  const chmod = CHMOD.test(haystack);
  const platformCheck = PLATFORM_CHECK.test(haystack);
  const writesExecutable = chmod && (networkReach || platformCheck);
  const parts = [];
  if (nativeBuild) parts.push('compiles a native addon during install');
  if (networkReach && platformCheck) parts.push('downloads a platform-specific file over the network');
  else if (networkReach) parts.push('reaches the network during install');
  if (execChild) parts.push('runs another program through child_process');
  if (writesExecutable) parts.push('makes a downloaded file executable (chmod)');
  else if (chmod) parts.push("changes a file's permissions (chmod)");
  const description = parts.length
    ? parts.join(', ') + '.'
    : `runs \`${command.length > 90 ? command.slice(0, 87) + '...' : command}\` during install, and nothing else these rules recognise.`;
  return { command, networkReach, nativeBuild, execChild, writesExecutable, description };
}

export function invokedFileContent(command, files) {
  const rel = extractInvokedFile(command);
  if (!rel) return undefined;
  const buf = files.get(rel);
  return buf ? buf.toString('utf8', 0, Math.min(buf.length, 20_000)) : undefined;
}
