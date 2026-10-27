// Launch availability is presentation only; configuration and submission guards stay in the controller.
export function ensureLaunchAvailability(document = globalThis.document) {
  if (!document?.querySelector) return null;
  const existing = document.querySelector('#launch-availability');
  if (existing) return existing;
  const heading = document.querySelector('#launch-dialog [data-launch-step="1"] > .step-heading');
  if (!heading) return null;
  const template = document.createElement('template');
  template.innerHTML = `<section class="launch-availability" id="launch-availability" data-state="checking" aria-labelledby="launch-availability-title">
                  <strong class="launch-availability-title" id="launch-availability-title">Launch availability</strong>
                  <div id="launch-availability-summary" role="status" aria-live="polite" aria-atomic="true">
                    <strong id="launch-availability-label">Checking launch service</strong>
                    <p id="launch-availability-guidance">You can prepare token details while this check runs.</p>
                  </div>
                  <details id="launch-availability-details"><summary>Technical details</summary><p class="field-help" id="fee-router-status">Checking V3 launch readiness…</p></details>
                </section>`;
  const row = template.content.firstElementChild;
  heading.after(row);
  return row;
}

export function updateLaunchAvailabilityView(appState, document = globalThis.document) {
    if (!document?.querySelector) return;
    const row = ensureLaunchAvailability(document);
    const label = document.querySelector('#launch-availability-label');
    const guidance = document.querySelector('#launch-availability-guidance');
    if (!row || !label || !guidance) return;
    const state = appState.feeRouterState;
    const verified = state?.status === 'verified' && state.verified === true;
    const checking = state?.status === 'checking' && state.verified !== true;
    const presentation = verified
      ? ['verified', 'Launch service verified', 'Your wallet, quote and final launch checks are still required.']
      : checking
        ? ['checking', 'Checking launch service', 'You can prepare token details while this check runs.']
        : ['unavailable', 'Submission unavailable', 'You can keep preparing your draft. Launch service verification has not passed.'];
    row.dataset.state = presentation[0];
    if (label.textContent !== presentation[1]) label.textContent = presentation[1];
    if (guidance.textContent !== presentation[2]) guidance.textContent = presentation[2];
    const panel = document.querySelector('#launch-dialog [data-launch-step="' + (appState.launchStep === 2 ? 2 : 1) + '"]');
    const heading = panel?.querySelector(':scope > .step-heading');
    if (heading && heading.nextElementSibling !== row) {
      // Move the same disclosure and children, preserving their state. Modern state-
      // preserving moves also retain focus if an active control is inside the row.
      if (typeof panel.moveBefore === 'function') panel.moveBefore(row, heading.nextSibling);
      else heading.after(row);
    }
}
