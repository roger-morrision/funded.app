export const capitalFlowDiagramMarkup = `<figure class="capital-flow-banner" data-flow-diagram>
  <div class="capital-flow-banner-viewport" role="region" aria-label="Capital flow diagram" aria-describedby="capital-flow-caption" tabindex="0"><img id="capital-flow-image" src="/capital-flow-landscape-static.svg" data-diagram-static="/capital-flow-landscape-static.svg" data-diagram-animated="/capital-flow-landscape.svg" width="1600" height="610" alt="Creator-fee route: eligible trades accrue creator fees, verified collection moves SOL into the V3 router, and the creator approves settlement and funding. The saved policy directs creator and protocol shares. Launch charges, migration claims, and policy-gated agency actions are separate paths." /></div>
  <figcaption id="capital-flow-caption">Policy illustration. Category rates and agency availability follow each coin’s saved policy and current execution checks. <span>Scroll or use arrow keys to explore the diagram.</span></figcaption>
  <div class="flow-diagram-controls"><button type="button" data-diagram-motion aria-controls="capital-flow-image" hidden>Play animation</button><a href="/capital-flow-landscape-static.svg" data-diagram-full target="_blank" rel="noopener noreferrer" aria-label="View full diagram — static version, opens in a new tab">View full diagram <span aria-hidden="true">↗</span></a></div>
</figure>
<details class="flow-text-guide">
  <summary>Read the flow as text</summary>
  <ol>
    <li><strong>Fees accrue</strong>Eligible trades generate creator fees. A trade alone does not confirm a payout.</li>
    <li><strong>Collect and settle</strong>Verified collection routes SOL for a mint into the fee router. Creator approval applies where required.</li>
    <li><strong>Fund saved allocations</strong>The coin’s saved creator and protocol split determines allocations. Execution depends on eligibility, approvals, minimums, and available funding.</li>
    <li><strong>Confirm delivery</strong>Inspect the receipts for completed rewards, purchases, and burns. Ranked bonus windows must close before winners can be paid.</li>
  </ol>
  <p>Launch charges, promotion payments, migration token claims, and policy-gated agency actions follow separate paths.</p>
</details>`;

// Presentation only; mount before bootstrap binds page interactions.
export function mountCapitalFlowDiagram(document = globalThis.document) {
  if (document?.querySelector('#capital-flow [data-flow-diagram]')) return;
  document?.querySelector('#capital-flow > .section-heading')?.insertAdjacentHTML('afterend', capitalFlowDiagramMarkup);
}
