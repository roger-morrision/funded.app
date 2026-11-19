// Transaction-local deltas remain exact even when another worker changes the
// same vault between RPC reads. Every recipient retains its original receipt.
export async function verifyRewardBatch({ connection, authority, plan, rows, signature, inspectLeaf }) {
  const tx = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!tx || tx.meta?.err !== null || !tx.transaction.signatures.includes(signature)
    || tx.transaction.message.header.numRequiredSignatures !== 1 || !Number.isSafeInteger(tx.meta.fee))
    throw new Error('Reward batch lacks a successful finalized transaction.');
  const keys = [...(tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys),
    ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58());
  if (keys[0] !== authority.toBase58()) throw new Error('Reward batch fee payer differs from the app authority.');
  const delta = address => {
    const index = keys.indexOf(address.toBase58());
    if (index < 0 || !Number.isSafeInteger(tx.meta.preBalances[index]) || !Number.isSafeInteger(tx.meta.postBalances[index]))
      throw new Error('Reward batch balance evidence is unavailable.');
    return BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index]);
  };
  const tokenDelta = address => {
    const index = keys.indexOf(address.toBase58());
    const before = tx.meta.preTokenBalances?.find(row => row.accountIndex === index && row.mint === plan.manifest.asset);
    const after = tx.meta.postTokenBalances?.find(row => row.accountIndex === index && row.mint === plan.manifest.asset);
    if (index < 0 || !after) throw new Error('Reward batch token evidence is unavailable.');
    return BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount || 0);
  };
  const total = rows.reduce((sum, row) => sum + BigInt(row.leaf.amount), 0n), sol = plan.manifest.asset === 'SOL';
  if ((sol ? delta(rows[0].vault) : tokenDelta(rows[0].vaultTokenAddress)) !== -total)
    throw new Error('Reward batch lacks the exact aggregate vault debit.');
  const results = [];
  for (const row of rows) {
    const record = await inspectLeaf(plan, row.leaf);
    if (!record || record.payment !== row.payment.toBase58()) throw new Error('Reward batch payment receipt is unavailable.');
    const paymentIndex = keys.indexOf(record.payment);
    if (paymentIndex < 0 || (!row.bitmap && tx.meta.preBalances[paymentIndex] !== 0) || tx.meta.postBalances[paymentIndex] <= 0)
      throw new Error('Reward batch did not create the expected payment receipt.');
    // Operational wallets are excluded by the scheduler. Do not apply the
    // recipient-only delta rule to a self-payment that also paid batch rent.
    if (row.recipient.equals(authority)) throw new Error('Batch recipients must differ from the app fee payer.');
    const received = sol ? delta(row.recipient) : tokenDelta(row.recipientTokenAddress);
    if (received !== BigInt(record.amountReceived) || (sol && received !== BigInt(row.leaf.amount)))
      throw new Error('Reward batch lacks an exact recipient credit.');
    results.push({ signature, finalized:true, balanceDeltaVerified:true, vaultBalanceDeltaVerified:true,
      amountReceived:record.amountReceived, payment:record.payment,bitmap:row.bitmap===true,
      batch:{ recipients:rows.length, feeLamports:String(tx.meta.fee), slot:tx.slot } });
  }
  return results;
}
