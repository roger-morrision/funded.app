// Wallet balance for one mint without indexed RPC methods. Free public RPCs
// refuse or rate-limit getTokenAccountsByOwner, so read the owner's associated
// token accounts (classic SPL and Token-2022) by address instead. Results keep
// the getTokenAccountsByOwner / getParsedTokenAccountsByOwner response shape.
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

async function ownerMintAddresses(owner, mint) {
  const { PublicKey } = await import('@solana/web3.js');
  const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const ownerKey = owner instanceof PublicKey ? owner : new PublicKey(String(owner));
  const mintKey = mint instanceof PublicKey ? mint : new PublicKey(String(mint));
  return [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(program => getAssociatedTokenAddressSync(mintKey, ownerKey, true, new PublicKey(program)));
}

export async function ownerMintAccounts(rpc, owner, mint, commitment = 'confirmed') {
  const addresses = await ownerMintAddresses(owner, mint);
  const infos = await rpc.getMultipleAccountsInfo(addresses, commitment);
  return { value: infos.flatMap((account, index) => account ? [{ pubkey: addresses[index], account }] : []) };
}

export async function ownerMintParsedAccounts(rpc, owner, mint, commitment = 'confirmed') {
  const addresses = await ownerMintAddresses(owner, mint);
  const infos = await rpc.getMultipleParsedAccounts(addresses, { commitment });
  return { value: infos.value.flatMap((account, index) => account?.data?.parsed?.info?.tokenAmount ? [{ pubkey: addresses[index], account }] : []) };
}
