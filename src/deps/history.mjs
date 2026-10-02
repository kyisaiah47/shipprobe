/* Who has been publishing a package, read entirely from the registry's own packument: its `time`
 * map and each version's `_npmUser`. The registry's version history is already a snapshot, so no
 * history of our own is needed. */

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function readPublishHistory(pkg, latestVersion, now = Date.now()) {
  const time = pkg.time || {};
  const entries = Object.entries(pkg.versions || {})
    .filter(([v]) => v in time)
    .map(([v, meta]) => ({ version: v, at: Date.parse(time[v]), publisher: meta?._npmUser?.name || null }))
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);

  const latestIdx = entries.findIndex((e) => e.version === latestVersion);
  const latestPublisher = latestIdx >= 0 ? entries[latestIdx].publisher : null;
  const previous10 = latestIdx >= 0 ? entries.slice(Math.max(0, latestIdx - 10), latestIdx) : [];
  const prevPublishers = new Set(previous10.map((e) => e.publisher).filter(Boolean));
  const differentAccountThanPrevious10 = !!latestPublisher && prevPublishers.size > 0 && !prevPublishers.has(latestPublisher);

  const cutoff = now - NINETY_DAYS_MS;
  const older = entries.filter((e) => e.at < cutoff);
  const recent = entries.filter((e) => e.at >= cutoff);
  const olderPublishers = new Set(older.map((e) => e.publisher).filter(Boolean));
  const recentPublishers = new Set(recent.map((e) => e.publisher).filter(Boolean));
  const newPublisherInLast90Days = older.length > 0 && [...recentPublishers].some((p) => !olderPublishers.has(p));

  return {
    latestVersion,
    latestPublisher,
    differentAccountThanPrevious10,
    newPublisherInLast90Days,
    ledger: entries.slice(-11).reverse().map((e) => ({ version: e.version, at: new Date(e.at).toISOString(), publisher: e.publisher })),
  };
}
