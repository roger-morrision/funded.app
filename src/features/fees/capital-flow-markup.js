export const capitalFlowDiagramMarkup = `<details class="capital-flow-guide" id="capital-flow-guide">
<summary>Explore the fee flow diagram</summary>
<figure class="capital-flow-banner" data-flow-diagram>
  <div class="capital-flow-banner-viewport" role="region" aria-label="Capital flow diagram" aria-describedby="capital-flow-caption" tabindex="0"><img id="capital-flow-image" src="/capital-flow-landscape-static.svg" data-diagram-static="/capital-flow-landscape-static.svg" data-diagram-animated="/capital-flow-landscape.svg" width="1600" height="610" alt="Creator-fee route: eligible trades accrue creator fees, verified collection moves SOL into the V3 router, and the keeper settles under the fixed policy when active. Funding and recipient payments are verified separately. The saved policy directs creator-directed, Operations &amp; marketing and separate ecosystem allocations. Launch charges, migration claims, and policy-gated agency actions are separate paths." /></div>
  <figcaption id="capital-flow-caption">Policy illustration. Category rates and agency availability follow each coin’s saved policy and current execution checks. <span>Scroll or use arrow keys to explore the diagram.</span></figcaption>
  <div class="flow-diagram-controls"><button type="button" data-diagram-motion aria-controls="capital-flow-image" hidden>Play animation</button><a href="/capital-flow-landscape-static.svg" data-diagram-full target="_blank" rel="noopener noreferrer" aria-label="View full diagram — static version, opens in a new tab">View full diagram <span aria-hidden="true">↗</span></a></div>
</figure>
</details>
<details class="flow-text-guide">
  <summary>Read the flow as text</summary>
  <ol>
    <li><strong>Trades earn fees</strong>Trades on a coin earn creator fees. A trade alone does not mean a payout has been made.</li>
    <li><strong>Collect fees</strong>The platform collects each coin’s fees and checks them. Automatic coins pay out without the creator signing; others wait for the creator’s approval.</li>
    <li><strong>Split and fund</strong>Fees are split by the rates the coin saved at launch. A payout goes out once it is eligible, approved, above the minimum and funded.</li>
    <li><strong>Pay and prove it</strong>Each reward, buyback and burn gets a receipt you can check. Daily bonus winners are paid after the day closes.</li>
  </ol>
  <p>Launch charges, promotion payments, migration token claims and AI marketing spend are handled separately.</p>
</details>`;

// Presentation only; mount before bootstrap binds page interactions.
export function mountCapitalFlowDiagram(document = globalThis.document) {
  if (document?.querySelector('#capital-flow [data-flow-diagram]')) return;
  const anchor = document?.querySelector('#capital-flow > .capital-flow-layout') || document?.querySelector('#capital-flow > .section-heading');
  anchor?.insertAdjacentHTML('afterend', capitalFlowDiagramMarkup);
}
