import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint, getMetadataPointerState, getTokenMetadata } from '@solana/spl-token';

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
  const uri=symbol.offset+4<=data.length&&data.readUInt32LE(symbol.offset)>0?metadataString(data,symbol.offset,2048,'URI').value:null;
  return { name:name.value, symbol:symbol.value,uri };
}

export async function readVerifiedTokenMetadata(connection, mint) {
  const address = tokenMetadataAddress(mint);
  const account = await connection.getAccountInfo(address, 'finalized');
  return { ...parseVerifiedTokenMetadata(account, mint), address:address.toBase58() };
}

export async function readVerifiedListingMint(connection, mint, { trustedLaunch = null, signedMetadata = null } = {}) {
  const mintKey = new PublicKey(mint);
  const account = await connection.getAccountInfo(mintKey, 'finalized');
  if (!account) throw new Error('Token not found on Solana Devnet. Mainnet tokens cannot be listed in this Devnet workspace. Use a Devnet token address.');
  if (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))
    throw new Error('The listing mint is not a supported SPL token on Solana.');
  const decoded=unpackMint(mintKey,account,account.owner);
  if(!decoded.isInitialized)throw new Error('This token mint is not initialized.');
  const identity={mint:mintKey.toBase58(),mintVerified:true,decimals:decoded.decimals,supplyBaseUnits:decoded.supply.toString(),
    tokenProgram:account.owner.equals(TOKEN_2022_PROGRAM_ID)?'Token-2022':'SPL Token'};
  // Launchpad and DEX affiliation does not determine listing eligibility.
  // Token-2022 stores metadata on the mint when its verified pointer is self-referential.
  if(account.owner.equals(TOKEN_2022_PROGRAM_ID)){
    const pointer=getMetadataPointerState(decoded);
    if(pointer?.metadataAddress?.equals(mintKey)){
      const metadata=await getTokenMetadata({getAccountInfo:async()=>account},mintKey,'finalized',TOKEN_2022_PROGRAM_ID);
      const clean=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f\ufffd]/.test(value)?value.trim():null;
      if(!metadata?.mint?.equals(mintKey))throw new Error('Token-2022 metadata does not match this mint.');
      const name=clean(metadata.name,256),symbol=clean(metadata.symbol,64);
      if(!name||!symbol)throw new Error('The on-chain token name or symbol is invalid.');
      return {...identity,name,symbol,uri:clean(metadata.uri,2048),address:mintKey.toBase58(),metadataStatus:'verified',source:'token-2022-onchain-finalized'};
    }
  }
  const metadataAccount=await connection.getAccountInfo(tokenMetadataAddress(mintKey),'finalized');
  if(metadataAccount)return {...identity,...parseVerifiedTokenMetadata(metadataAccount,mintKey),address:tokenMetadataAddress(mintKey).toBase58(),metadataStatus:'verified',source:'metaplex-onchain-finalized'};
  if (trustedLaunch?.mint === mintKey.toBase58() && trustedLaunch.onchainVerified === true && trustedLaunch.cluster === 'devnet'
    && signedMetadata?.mint === mintKey.toBase58() && signedMetadata.creatorWallet === trustedLaunch.creatorWallet
    && signedMetadata.name === trustedLaunch.name && signedMetadata.symbol === trustedLaunch.symbol
    && signedMetadata.name && signedMetadata.symbol) {
    return { ...identity, name:signedMetadata.name, symbol:signedMetadata.symbol,
      address:null,metadataStatus:'verified',source:'funded-signed-metadata-and-verified-launch' };
  }
  // A valid SPL mint without supported name metadata can still be listed by
  // address. These labels are explicit fallbacks, never a verified identity.
  return {...identity,name:`Token ${mintKey.toBase58().slice(0,6)}…${mintKey.toBase58().slice(-4)}`,symbol:'TOKEN',
    address:null,uri:null,metadataStatus:'missing',source:'spl-mint-onchain-finalized'};
}
