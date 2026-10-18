// Mount before application bootstrap so calculator controls exist for event binding.
export const feeFlowCalculatorMarkup = `<article class="panel fee-flow-calculator">
              <div class="panel-heading"><div><p class="eyebrow">Creator-fee calculator</p><h2>What happens to a claim?</h2></div><span class="flow-unit">SOL</span></div>
              <label class="fee-input-label">Gross creator fees claimed<input id="fee-flow-input" type="number" min="0" step="any" value="100" inputmode="decimal" /><small>Example only. No funds move.</small></label>
              <div class="fee-route-bar" aria-label="Fee distribution"><i class="creator" style="width:80%"></i><i class="operations" style="width:8%"></i><i class="referrals" style="width:3%"></i><i class="community" style="width:4%"></i><i class="burn" style="width:5%"></i></div>
              <div class="fee-output-grid">
                <div class="creator"><span>Creator-directed</span><strong id="fee-output-creator">80 SOL</strong><small>80% of gross</small></div>
                <div class="operations"><span>Operations &amp; marketing</span><strong id="fee-output-operations">8 SOL</strong><small>8% of gross</small></div>
                <div class="referrals"><span>Referral network</span><strong id="fee-output-referrals">3 SOL</strong><small>L1 2% · L2 0.6% · L3 0.4%</small></div>
                <div class="community"><span>Daily bonus</span><strong id="fee-output-community">4 SOL</strong><small>4% of gross</small></div>
                <div class="burn"><span>$FUNDED buyback</span><strong id="fee-output-buyback">5 SOL</strong><small>5% of gross</small></div>
              </div>
              <p class="fee-flow-note" id="fee-flow-note">A 100 SOL claim allocates exactly 100 SOL under the published policy.</p>
            </article>`;

export function mountFeeFlowCalculator(document = globalThis.document) {
  const target = document?.getElementById('fee-calculator-mount');
  if (target) target.outerHTML = feeFlowCalculatorMarkup;
}
