/* Findings and one verdict from what the tarball and the registry handed back.
 *
 *   pass      no install-time script
 *   low       a script runs, and everything it does stays on disk
 *   medium    a native addon is compiled, or the publishing account changed
 *   high      a script reaches the network during install
 *   critical  a script reaches the network AND the publishing account changed recently, which is
 *             the shape of a compromised maintainer account shipping a malicious update
 */

export const SEVERITY_WEIGHT = { critical: 40, high: 22, medium: 10, low: 4, pass: 0 };

export const VERDICT_LABEL = {
  pass: 'Clean',
  low: 'Runs locally',
  medium: 'Builds native code',
  high: 'Reaches the network',
  critical: 'Reaches the network, freshly published',
};

export const VERDICT_DETAIL = {
  pass: 'No preinstall, install, postinstall or prepare script. Nothing runs when this installs.',
  low: 'Runs a script at install, and everything it does stays on disk. No network call and no native compile.',
  medium: 'Compiles a native addon during install, or was published by a changed account. Worth knowing before it runs on a machine you did not build it on.',
  high: 'A script reaches the network during install, downloading a file or calling another host.',
  critical: 'A script reaches the network during install, and the account publishing this package changed in the last ninety days.',
};

export function worst(sevs) {
  return sevs.reduce((a, b) => (SEVERITY_WEIGHT[b] > SEVERITY_WEIGHT[a] ? b : a), 'pass');
}

export function buildVerdict(scripts, hasNativeBuildFile, history) {
  const findings = [];
  if (!scripts.length && !hasNativeBuildFile) {
    findings.push({ id: 'no-scripts', category: 'scripts', severity: 'pass', title: 'No install-time scripts', detail: VERDICT_DETAIL.pass });
  }
  for (const s of scripts) {
    findings.push({
      id: `script-${s.script}`,
      category: s.networkReach ? 'network' : s.nativeBuild ? 'native' : 'scripts',
      severity: s.networkReach ? 'high' : s.nativeBuild ? 'medium' : 'low',
      title: `${s.script}: ${s.description}`,
      detail: s.command,
      where: s.invokedFile ? `${s.script} -> ${s.invokedFile}` : s.script,
    });
  }
  if (hasNativeBuildFile && !scripts.some((s) => s.nativeBuild)) {
    findings.push({
      id: 'native-build-file',
      category: 'native',
      severity: 'medium',
      title: 'Ships a binding.gyp',
      detail: 'The package carries a node-gyp build file although no lifecycle script names node-gyp, so it is most likely built through npm\'s default install step.',
    });
  }
  if (history?.differentAccountThanPrevious10) {
    findings.push({
      id: 'publisher-changed',
      category: 'publish',
      severity: 'medium',
      title: 'Published by a different account than the last ten versions',
      detail: `Version ${history.latestVersion} was published by ${history.latestPublisher || 'an unknown account'}, who published none of the ten versions before it.`,
    });
  }
  if (history?.newPublisherInLast90Days) {
    findings.push({
      id: 'new-publisher-90d',
      category: 'publish',
      severity: 'medium',
      title: 'A new publishing account appeared in the last ninety days',
      detail: 'An account with no earlier publish on this package started publishing it within the last ninety days. The registry does not return who held maintainer rights ninety days ago, so this reads who actually published over that window.',
    });
  }
  const networkReach = scripts.some((s) => s.networkReach);
  const fresh = !!history && (history.differentAccountThanPrevious10 || history.newPublisherInLast90Days);
  if (networkReach && fresh) {
    findings.push({ id: 'network-and-fresh-publish', category: 'publish', severity: 'critical', title: 'Reaches the network and was freshly published by a changed account', detail: VERDICT_DETAIL.critical });
  }
  return { findings, verdict: worst(findings.map((f) => f.severity)) };
}
