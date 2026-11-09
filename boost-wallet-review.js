const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const MAX_BOOST_NETWORK_FEE_LAMPORTS = 1_000_000;

// Copy all payment fields before handing the transaction to a wallet, which may
// mutate the same object when inserting its priority-fee instructions.
export function snapshotBoostPayment(transaction) {
  return {
    feePayer: transaction.feePayer?.toBase58(),
    blockhash: transaction.recentBlockhash,
    instructions: transaction.instructions.map(instruction => ({
      program: instruction.programId.toBase58(),
      keys: instruction.keys.map(key => ({ address: key.pubkey.toBase58(),
        signer: key.isSigner, writable: key.isWritable })),
      data: Array.from(instruction.data),
    })),
  };
}

export function assertBoostWalletPayment(signedTransaction, reviewed) {
  const actual = snapshotBoostPayment(signedTransaction);
  const settings = new Set();
  while (actual.instructions[0]?.program === COMPUTE_BUDGET_PROGRAM) {
    const instruction = actual.instructions.shift();
    const type = instruction.data[0];
    if (instruction.keys.length || settings.has(type)
      || !((type === 2 && instruction.data.length === 5 && instruction.data.slice(1).some(byte => byte !== 0))
        || (type === 3 && instruction.data.length === 9))) {
      throw Error('Wallet added unsupported payment fee settings. No payment was sent.');
    }
    settings.add(type);
  }
  // Only leading unit-limit/unit-price settings may differ. The transfer, memo,
  // payer, blockhash, account privileges and every other instruction stay exact.
  if (JSON.stringify(actual) !== JSON.stringify(reviewed)) {
    throw Error('Wallet changed the reviewed payment details. No payment was sent.');
  }
}
