import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export function tokenMetadataAddress(mint) {
  const mintKey = new PublicKey(mint);
  return PublicKey.findProgramAddressSync([
    Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKey.toBuffer(),
  ], TOKEN_METADATA_PROGRAM_ID)[0];
}

function metadataString(data, offset, maxBytes, label) {
  if (offset + 4 > data.length) throw new Error(`The token metadata ${label} is truncated.`);
  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (length === 0 || length > maxBytes || end > data.length) throw new Error(`The token metadata ${label} is invalid.`);
  const value = data.subarray(start, end).toString('utf8').replace(/\0+$/g, '').trim();
  if (!value || value.includes('\ufffd') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`The token metadata ${label} is invalid.`);
  return { value, offset:end };
}

export function parseVerifiedTokenMetadata(account, mint) {
  const mintKey = new PublicKey(mint);
  if (!account?.owner?.equals(TOKEN_METADATA_PROGRAM_ID)) throw new Error('The token has no verified Metaplex metadata account.');
  const data = Buffer.from(account.data || []);
  if (data.length < 69 || data[0] !== 4 || !new PublicKey(data.subarray(33, 65)).equals(mintKey))
    throw new Error('The token metadata account does not match the listed mint.');
  const name = metadataString(data, 65, 32, 'name');
  const symbol = metadataString(data, name.offset, 10, 'symbol');
  return { name:name.value, symbol:symbol.value };
}

export async function readVerifiedTokenMetadata(connection, mint) {
  const address = tokenMetadataAddress(mint);
  const account = await connection.getAccountInfo(address, 'finalized');
  return { ...parseVerifiedTokenMetadata(account, mint), address:address.toBase58() };
}

export async function readVerifiedListingMint(connection, mint, { trustedLaunch = null, signedMetadata = null } = {}) {
  const mintKey = new PublicKey(mint);
  const account = await connection.getAccountInfo(mintKey, 'finalized');
  if (!account || (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID)))
    throw new Error('The listing mint is not a supported SPL token on Solana.');
  await connection.getTokenSupply(mintKey, 'finalized');
  if (trustedLaunch?.mint === mintKey.toBase58() && trustedLaunch.onchainVerified === true && trustedLaunch.cluster === 'devnet'
    && signedMetadata?.mint === mintKey.toBase58() && signedMetadata.creatorWallet === trustedLaunch.creatorWallet
    && signedMetadata.name === trustedLaunch.name && signedMetadata.symbol === trustedLaunch.symbol
    && signedMetadata.name && signedMetadata.symbol) {
    return { mint:mintKey.toBase58(), name:signedMetadata.name, symbol:signedMetadata.symbol,
      address:null, source:'funded-signed-metadata-and-verified-launch' };
  }
  const metadata = await readVerifiedTokenMetadata(connection, mintKey);
  return { mint:mintKey.toBase58(), ...metadata, source:'metaplex-onchain-finalized' };
}
