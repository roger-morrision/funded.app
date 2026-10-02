const curves = new Map();

export function publishVerifiedCurves(items) {
  curves.clear();
  for (const item of items) {
    const percent = Number(item?.curveProgressPercent);
    if (item?.complete !== false || item.curveProgressPercent == null || !Number.isFinite(percent)) continue;
    curves.set(item.address, Math.max(0, Math.min(100, percent)));
  }
  document.dispatchEvent(new Event('funded:verified-curves'));
}

export function verifiedCurveProgress(mint) {
  return curves.get(mint) ?? null;
}
