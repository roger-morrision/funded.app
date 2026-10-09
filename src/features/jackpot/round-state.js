export const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export const validLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value));

export const activeRound = round => round?.payoutEnabled === true
    && round?.fundingVerified === true
    && round?.rulesPublished === true
    && round?.eligibilityApproved === true
    && validLamports(round?.fundedLamports)
    && BigInt(round.fundedLamports) > 0n
    && Number.isSafeInteger(round?.entries)
    && round.entries > 0;

export const solAmount = value => {
    if (!validLamports(value)) return 'unavailable';
    const lamports = BigInt(value);
    return `${lamports / 1_000_000_000n}.${String(lamports % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '') || '0'} SOL`;
  };
