// Plain-language labels for the Explore data status. The internal provider
// status keeps its technical wording because other code matches on it; only
// the text people see is translated here.

export function exploreStatusText(status) {
  const value = String(status || '');
  if (!value || /loading/i.test(value)) return 'Loading coins…';
  const busy = /rate limited/i.test(value);
  if (/stale/i.test(value)) {
    const age = value.match(/last verified (\d+[smhd] ago)/)?.[1];
    const shown = age ? `Showing coins from ${age}` : 'Showing last saved coins';
    return busy ? `Network busy · ${shown.toLowerCase()}` : shown;
  }
  if (busy) return 'Network busy · retrying shortly';
  if (/live mint checks unavailable/i.test(value)) return 'Coin checks unavailable right now';
  if (/unavailable/i.test(value)) return 'Live data unavailable right now';
  return value;
}

export function exploreSourceLabel(status) {
  const value = String(status || '');
  if (value.includes('Verified launch registry')) return 'Verified coins';
  if (value.includes('stale')) return 'Last saved data';
  if (value.includes('RPC verified')) return 'Up to date';
  if (value.includes('unavailable')) return 'Live data unavailable';
  return 'Checking coins…';
}
