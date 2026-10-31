export const capitalFlowDiagramMarkup = `<figure class="capital-flow-banner" data-flow-diagram>
  <div class="capital-flow-banner-viewport" role="region" aria-label="Capital flow diagram" aria-describedby="capital-flow-caption" tabindex="0"><img id="capital-flow-image" src="/capital-flow-landscape-static.svg" data-diagram-static="/capital-flow-landscape-static.svg" data-diagram-animated="/capital-flow-landscape.svg" width="1600" height="610" alt="Creator-fee route: eligible trades accrue creator fees, verified collection moves SOL into the V3 router, and the creator approves settlement and funding. The saved policy directs creator and protocol shares. Launch charges, migration claims, and policy-gated agency actions are separate paths." /></div>
  <figcaption id="capital-flow-caption">Policy illustration. Category rates and agency availability follow each coin’s saved policy and current execution checks. <span>Swipe or use arrow keys to see the full flow.</span></figcaption>
  <div class="flow-diagram-controls"><button type="button" data-diagram-motion aria-controls="capital-flow-image" hidden>Play animation</button><a href="/capital-flow-landscape-static.svg" data-diagram-full target="_blank" rel="noopener noreferrer" aria-label="View full diagram — static version, opens in a new tab">View full diagram <span aria-hidden="true">↗</span></a></div>
</figure>`;

// Presentation only; mount before bootstrap binds page interactions.
export function mountCapitalFlowDiagram(document = globalThis.document) {
  if (document?.querySelector('#capital-flow [data-flow-diagram]')) return;
  document?.querySelector('#capital-flow > .section-heading')?.insertAdjacentHTML('afterend', capitalFlowDiagramMarkup);
}
