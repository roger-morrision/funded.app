import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readVerifiedListingMint, parseVerifiedTokenMetadata, tokenMetadataAddress, TOKEN_METADATA_PROGRAM_ID } from '../server/token-metadata.mjs';
import { verifyFundedBurn } from '../server/burn-verification.mjs';

const mint = new PublicKey('So11111111111111111111111111111111111111112');
const wallet = '11111111111111111111111111111111';

function metadata(name = 'Listed Token', symbol = 'LIST', recordedMint = mint) {
  const field = text => { const bytes = Buffer.from(text); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
  return { owner:TOKEN_METADATA_PROGRAM_ID,
    data:Buffer.concat([Buffer.from([4]), Buffer.alloc(32), recordedMint.toBuffer(), field(name), field(symbol), field('https://example.org')]) };
}

test('listing name and ticker come from finalized metadata bound to the mint', async () => {
  const address = tokenMetadataAddress(mint).toBase58();
  const calls = [];
  const rpc = {
    async getAccountInfo(key, commitment) {
      calls.push([key.toBase58(), commitment]);
      return key.equals(mint) ? { owner:TOKEN_PROGRAM_ID } : key.toBase58() === address ? metadata() : null;
    },
    async getTokenSupply(key, commitment) { calls.push([key.toBase58(), commitment]); return { value:{ amount:'1000000' } }; },
  };
  const result = await readVerifiedListingMint(rpc, mint);
  assert.deepEqual(result, { mint:mint.toBase58(), name:'Listed Token', symbol:'LIST', address, source:'metaplex-onchain-finalized' });
  assert.ok(calls.every(([, commitment]) => commitment === 'finalized'));
});

test('funded launch uses its verified registry and signed metadata when Metaplex PDA is absent', async () => {
  const mintText = mint.toBase58();
  const launch = { mint:mintText, cluster:'devnet', onchainVerified:true, creatorWallet:wallet, name:'Fresh Coin', symbol:'FC' };
  const signedMetadata = { mint:mintText, creatorWallet:wallet, name:'Fresh Coin', symbol:'FC' };
  const rpc = { async getAccountInfo(key) { return key.equals(mint) ? { owner:TOKEN_PROGRAM_ID } : null; },
    async getTokenSupply() { return { value:{ amount:'1000000' } }; } };
  const result = await readVerifiedListingMint(rpc, mint, { trustedLaunch:launch, signedMetadata });
  assert.equal(result.source, 'funded-signed-metadata-and-verified-launch');
  assert.equal(result.name, 'Fresh Coin');
  await assert.rejects(readVerifiedListingMint(rpc, mint, { trustedLaunch:launch, signedMetadata:{ ...signedMetadata, symbol:'FAKE' } }), /no verified Metaplex metadata/);
});

test('wrong owner, wrong embedded mint and malformed metadata fail closed', () => {
  assert.throws(() => parseVerifiedTokenMetadata({ ...metadata(), owner:TOKEN_PROGRAM_ID }, mint), /no verified/);
  assert.throws(() => parseVerifiedTokenMetadata(metadata('Listed Token', 'LIST', new PublicKey(wallet)), mint), /does not match/);
  assert.throws(() => parseVerifiedTokenMetadata({ ...metadata(), data:metadata().data.subarray(0, 69) }, mint), /truncated|invalid/);
  assert.throws(() => parseVerifiedTokenMetadata(metadata('Name\nspoof', 'LIST'), mint), /invalid/);
});

test('burn verification requests finalized transaction and supply', async () => {
  const fundedMint = mint.toBase58();
  const source = 'SourceAccount';
  const seen = [];
  const rpc = {
    async getParsedTransaction(signature, options) {
      seen.push(['transaction', options.commitment]);
      return { slot:12, blockTime:123,
        meta:{ err:null, preTokenBalances:[{accountIndex:1,mint:fundedMint,owner:wallet,uiTokenAmount:{amount:'500'}}],
          postTokenBalances:[{accountIndex:1,mint:fundedMint,owner:wallet,uiTokenAmount:{amount:'400'}}] },
        transaction:{ message:{ accountKeys:[wallet,source], instructions:[{ programId:TOKEN_PROGRAM_ID,
          parsed:{ type:'burnChecked', info:{ mint:fundedMint, authority:wallet, account:source, tokenAmount:{amount:'100',decimals:6} } } }] } } };
    },
    async getTokenSupply(key, commitment) { seen.push(['supply', commitment]); return { value:{ amount:'900' } }; },
  };
  const proof = await verifyFundedBurn({ connection:rpc, signature:'test-signature', fundedMint, wallet, amountBaseUnits:'100' });
  assert.equal(proof.amountBaseUnits, '100');
  assert.deepEqual(seen, [['transaction','finalized'],['supply','finalized']]);
});
