export const FUNDED_INITIAL_SUPPLY_TOKENS = 1_000_000_000;

export function projectBurnMemo(projectMint) {
  const mint = String(projectMint || '').trim();
  if (!mint) throw new Error('A project mint is required for attributed burns.');
  return `funded.vip:project-burn:v1:${mint}`;
}

export function parseTokenAmount(value, decimals) {
  const text = String(value ?? '').trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Token decimals are invalid.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new Error('Enter a positive token amount.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`);
  const amount = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (amount <= 0n) throw new Error('Enter a token amount above zero.');
  return amount;
}

export function formatTokenBaseUnits(amount, decimals, maximumFractionDigits = decimals) {
  const units = BigInt(amount ?? 0);
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, maximumFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function burnedSupplyBaseUnits(currentSupply, decimals, initialSupplyTokens = FUNDED_INITIAL_SUPPLY_TOKENS) {
  const initial = BigInt(initialSupplyTokens) * (10n ** BigInt(decimals));
  const current = BigInt(currentSupply ?? 0);
  return current < initial ? initial - current : 0n;
}

export function planTokenAccountBurns(tokenAccounts = [], amountBaseUnits) {
  let remaining = BigInt(amountBaseUnits ?? 0);
  if (remaining <= 0n) throw new Error('Enter a token amount above zero.');
  const burns = [];
  for (const account of tokenAccounts) {
    const available = BigInt(account?.amount ?? 0);
    if (available <= 0n || remaining <= 0n) continue;
    const amount = available < remaining ? available : remaining;
    burns.push({ address: account.address, amount });
    remaining -= amount;
  }
  if (remaining > 0n) throw new Error('The burn amount exceeds this wallet’s $FUNDED balance.');
  return burns;
}

export async function waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight = null, commitment = 'confirmed', timeoutMs = 90_000, pollIntervalMs = 1_000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value?.[0];
    if (status?.err) return { value: { err: status.err }, status };
    if (status && (status.confirmationStatus === 'finalized' || (commitment === 'confirmed' && status.confirmationStatus === 'confirmed'))) return { value: { err: null }, status };
    if (lastValidBlockHeight != null && await connection.getBlockHeight(commitment) > lastValidBlockHeight) throw new Error('The transaction blockhash expired before confirmation. Check the signature before retrying.');
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('Confirmation timed out. Check the submitted signature before retrying.');
}
