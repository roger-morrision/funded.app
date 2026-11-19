// Load optional enhancements once, when their route first becomes visible.
// A failed download can be retried on the next navigation.
export function installRouteFeatures(features, target = globalThis) {
  const loaded = new Map();
  const visit = event => {
    const active = [...(target.document?.body?.classList || [])].find(name => name.startsWith('page-route-'))?.slice(11);
    const route = `${target.location?.pathname || '/'}${target.location?.search || ''}${target.location?.hash || '#overview'}#${event?.detail?.route || active || ''}`;
    for (const feature of features) if (feature.matches.test(route) && !loaded.has(feature)) {
      const task = Promise.resolve().then(feature.load).catch(error => {
        loaded.delete(feature);
        console.error(`Could not load ${feature.name}:`, error);
      });
      loaded.set(feature, task);
    }
  };
  target.addEventListener('hashchange', visit);
  target.addEventListener('popstate', visit);
  target.addEventListener('funded:route-change', visit);
  visit();
  return visit;
}
