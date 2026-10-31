// Mount before application bootstrap so calculator controls exist for event binding.
export const feeFlowCalculatorMarkup = `<article class="panel fee-flow-calculator">
              <div class="panel-heading"><div><p class="eyebrow">Fee calculator</p><h2>Preview a fee split</h2></div><span class="flow-unit">SOL</span></div>
              <label class="fee-input-label">Gross creator fees claimed<input id="fee-flow-input" type="number" min="0" step="any" value="100" inputmode="decimal" aria-describedby="fee-flow-example fee-flow-feedback" aria-invalid="false" /><small id="fee-flow-example">Example only. No funds move.</small></label>
              <p class="fee-flow-feedback" id="fee-flow-feedback" role="status" aria-live="polite" aria-atomic="true">Preview ready.</p>
              <div class="fee-route-bar" aria-label="Fee distribution"><i class="creator" style="width:80%"></i><i class="operations" style="width:8%"></i><i class="referrals" style="width:1%"></i><i class="community" style="width:4%"></i><i class="burn" style="width:5%"></i><i class="agency" data-agency-fee style="width:2%;background:#6bd6c3"></i></div>
              <div class="fee-output-grid">
                <div class="creator"><span>Creator-directed</span><strong id="fee-output-creator">80 SOL</strong><small>80% of gross</small></div>
                <div class="operations"><span>Operations &amp; marketing</span><strong id="fee-output-operations">8 SOL</strong><small>8% of gross</small></div>
                <div class="referrals"><span>Referral network</span><strong id="fee-output-referrals">1 SOL</strong><small>L1 0.6% · L2 0.25% · L3 0.15%</small></div>
                <div class="community"><span>Daily bonus</span><strong id="fee-output-community">4 SOL</strong><small>4% of gross</small></div>
                <div class="burn"><span>$FUNDED buyback</span><strong id="fee-output-buyback">5 SOL</strong><small>5% of gross</small></div><div class="agency" data-agency-fee><span>AI marketing &amp; coin buybacks</span><strong id="fee-output-agency">2 SOL</strong><small>2% of gross</small></div>
              </div>
              <p class="fee-flow-note" id="fee-flow-note">A 100 SOL claim allocates exactly 100 SOL under the published policy.</p>
            </article>`;

export function mountFeeFlowCalculator(document = globalThis.document) {
  const target = document?.getElementById('fee-calculator-mount');
  if (target) target.outerHTML = feeFlowCalculatorMarkup;
}
