const DAY = 86_400_000;
const allowed = new Set(['draft-started', 'draft-reviewed', 'save-coin', 'follow-creator',
  'watched-coin-view', 'followed-creator-view', 'verified-reward-view', 'creator-update-published',
  'jackpot-home-view', 'jackpot-rewards-view', 'jackpot-open', 'jackpot-rules-view']);
const activation = new Set(['draft-reviewed', 'save-coin', 'follow-creator']);
const usefulReturn = new Set(['watched-coin-view', 'followed-creator-view', 'verified-reward-view']);

function eventRows(record) {
  return (Array.isArray(record?.events) ? record.events : [])
    .filter(row => allowed.has(row?.name) && Number.isFinite(Date.parse(row.at)))
    .map(row => ({ name:row.name, at:Date.parse(row.at) }))
    .sort((a, b) => a.at - b.at);
}

export function summarizePilot(records, asOf = Date.now()) {
  if (!Number.isFinite(asOf)) throw new Error('Invalid observation time.');
  const unique = new Map();
  for (const row of records || []) {
    if (!/^[0-9a-f-]{36}$/i.test(String(row?.participantId || '')) || row?.consented !== true
      || row?.source === 'test') continue;
    const prior = unique.get(row.participantId);
    if (!prior || eventRows(row).length > eventRows(prior).length) unique.set(row.participantId, row);
  }
  const counts = { participants:unique.size, draftStarters:0, draftReviewed:0,
    d7Eligible:0, d7Returned:0, creatorFollowThroughEligible:0, creatorSecondUpdate:0,
    jackpotHomeViewers:0, jackpotRewardsViewers:0, jackpotOpeners:0, jackpotRulesReaders:0 };
  for (const record of unique.values()) {
    const events = eventRows(record);
    const first = name => events.find(row => row.name === name)?.at;
    if (first('jackpot-home-view') != null) counts.jackpotHomeViewers++;
    if (first('jackpot-rewards-view') != null) counts.jackpotRewardsViewers++;
    if (first('jackpot-open') != null) counts.jackpotOpeners++;
    if (first('jackpot-rules-view') != null) counts.jackpotRulesReaders++;
    const draft = first('draft-started');
    if (draft != null) {
      counts.draftStarters++;
      if (events.some(row => row.name === 'draft-reviewed' && row.at >= draft)) counts.draftReviewed++;
    }
    const activated = events.find(row => activation.has(row.name))?.at;
    if (activated != null) {
      const day0 = Math.floor(activated / DAY) * DAY;
      if (asOf >= day0 + 8 * DAY) {
        counts.d7Eligible++;
        if (events.some(row => usefulReturn.has(row.name) && row.at >= day0 + 7 * DAY
          && row.at < day0 + 8 * DAY)) counts.d7Returned++;
      }
    }
    const firstUpdate = first('creator-update-published');
    if (firstUpdate != null && asOf >= firstUpdate + 14 * DAY) {
      counts.creatorFollowThroughEligible++;
      if (events.filter(row => row.name === 'creator-update-published'
        && row.at >= firstUpdate && row.at <= firstUpdate + 14 * DAY).length >= 2) counts.creatorSecondUpdate++;
    }
  }
  return { ...counts, draftToReviewRate:counts.draftStarters ? counts.draftReviewed / counts.draftStarters : null,
    d7RetentionRate:counts.d7Eligible ? counts.d7Returned / counts.d7Eligible : null,
    creatorFollowThroughRate:counts.creatorFollowThroughEligible
      ? counts.creatorSecondUpdate / counts.creatorFollowThroughEligible : null };
}
