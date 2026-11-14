// Devnet test deployments may offer a 5-minute developer lock so the unlock and
// release flow can be tested quickly. Show it only when the deployment's
// verified escrow configuration includes it.
export async function offerTestLockPeriod(app) {
  const select = document.querySelector('#creator-buy-lock-period');
  if (!select || select.querySelector('option[value="300"]')) return;
  const result = await app.apiRequest?.('/api/launch-reserve-config').catch(() => null);
  const config = result?.available ? result.data : null;
  if (config?.cluster !== 'devnet' || !config.developerTokenLock?.lockPeriodsSeconds?.includes(300)) return;
  const option = document.createElement('option');
  option.value = '300'; option.textContent = '5 min (Devnet test)';
  select.prepend(option);
}
