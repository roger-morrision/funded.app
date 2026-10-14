const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const LAMPORTS = 1_000_000_000n;

export function walletHistorySol(lamports) {
  if (!/^(0|[1-9]\d*)$/.test(String(lamports))) return null;
  const amount = BigInt(lamports);
  const fraction = String(amount % LAMPORTS).padStart(9, '0').replace(/0+$/, '');
  return `${amount / LAMPORTS}${fraction ? `.${fraction}` : ''} SOL`;
}

export function walletHistoryTokenAmount(baseUnits, reservedTokens, totalBaseUnits) {
  if (!/^(0|[1-9]\d*)$/.test(String(baseUnits))
    || !/^[1-9]\d*$/.test(String(reservedTokens))
    || !/^[1-9]\d*$/.test(String(totalBaseUnits))) return null;
  const scale = BigInt(totalBaseUnits) / BigInt(reservedTokens);
  if (scale * BigInt(reservedTokens) !== BigInt(totalBaseUnits)
    || ![1n,10n,100n,1000n,10000n,100000n,1000000n,10000000n,100000000n,1000000000n].includes(scale))
    return null;
  const whole = BigInt(baseUnits) / scale;
  const fraction = scale === 1n ? '' : String(BigInt(baseUnits) % scale).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

export function walletHistoryRows({ wallet, experience, airdrops = [], bonusClaims = [] }) {
  if (!ADDRESS.test(String(wallet || ''))) return [];
  const rows = [];
  const seen = new Set();
  if (experience?.cluster === 'devnet' && experience.wallet?.address === wallet) {
    for (const token of experience.wallet.rows || []) {
      if (!ADDRESS.test(String(token.mint || ''))) continue;
      for (const payout of token.payouts || []) {
        if (payout.wallet !== wallet || payout.feeSourceVerified !== true
          || !SIGNATURE.test(String(payout.signature || ''))
          || !['holder','x','creator'].includes(payout.kind)
          || !/^[1-9]\d*$/.test(String(payout.amountLamports || ''))) continue;
        const id = `payout:${payout.signature}`;
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, type:payout.kind === 'holder' ? 'reward' : 'claim',
          title:payout.kind === 'x' ? 'X reward claimed'
            : payout.kind === 'creator' ? 'Creator fee claimed' : 'Holder reward received',
          detail:`${token.symbol || 'Token'} · finalized V3 payment`,
          amount:walletHistorySol(payout.amountLamports), signature:payout.signature,
          href:`https://explorer.solana.com/tx/${encodeURIComponent(payout.signature)}?cluster=devnet`,
          time:Date.parse(payout.paidAt || '') || 0 });
      }
    }
  }
  for (const entry of airdrops) {
    const proof = entry?.proof;
    if (!ADDRESS.test(String(entry?.mint || '')) || proof?.status !== 'claimed'
      || proof.recipient !== wallet || !ADDRESS.test(String(proof.payment || ''))
      || !/^[1-9]\d*$/.test(String(proof.amount || ''))) continue;
    const id = `airdrop:${entry.mint}:${proof.payment}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const amount = walletHistoryTokenAmount(proof.amount, entry.reservedTokens, entry.totalBaseUnits);
    rows.push({ id, type:'airdrop', title:'Community airdrop claimed',
      detail:`${entry.symbol || 'Token'} · finalized payment account`,
      amount:amount ? `${amount} ${entry.symbol || 'tokens'}` : 'Claim confirmed',
      href:`https://explorer.solana.com/address/${encodeURIComponent(proof.payment)}?cluster=devnet`,
      time:0 });
  }
  for (const claim of bonusClaims) {
    if (claim?.status !== 'paid' || claim.finalized !== true || claim.balanceDeltaVerified !== true
      || claim.recipientWallet !== wallet || claim.asset !== 'SOL'
      || !SIGNATURE.test(String(claim.payoutSignature || ''))
      || !/^(0|[1-9]\d*)(?:\.\d{1,9})?$/.test(String(claim.amount || ''))) continue;
    const id = `bonus:${claim.payoutSignature}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const [whole, fraction = ''] = String(claim.amount).split('.');
    rows.push({ id, type:'bonus', title:'Referral bonus received',
      detail:`Level ${Number.isInteger(Number(claim.level)) ? claim.level : '—'} · finalized payout`,
      amount:walletHistorySol(BigInt(whole) * LAMPORTS + BigInt(fraction.padEnd(9, '0'))),
      href:`https://explorer.solana.com/tx/${encodeURIComponent(claim.payoutSignature)}?cluster=devnet`,
      time:Date.parse(claim.paidAt || '') || 0 });
  }
  return rows.sort((a,b) => b.time - a.time || a.id.localeCompare(b.id));
}
