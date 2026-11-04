import test from 'node:test';import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {isDeletedDevnetMint} from '../server/deleted-devnet-mints.mjs';
import {parseSignedMetadata} from '../server/devnet-metadata.mjs';
import {readUnindexedV3BuybackVaults} from '../server/v3-buyback-dashboard.mjs';
test('deleted old Devnet coins cannot be recreated through metadata or vault rediscovery',async()=>{
  const mint='26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg';
  assert(isDeletedDevnetMint(mint));assert.equal(isDeletedDevnetMint(mint,'mainnet-beta'),false);
  assert.throws(()=>parseSignedMetadata({mint}),/permanently removed/);
  const data=Buffer.alloc(249);Buffer.from('25d0c7eca736c38f','hex').copy(data);new PublicKey(mint).toBuffer().copy(data,8);
  const rows=await readUnindexedV3BuybackVaults({connection:{getProgramAccounts:async()=>[{pubkey:PublicKey.default,account:{data}}]},
    programId:PublicKey.default,indexedMints:new Set(),reserve:0n});
  assert.deepEqual(rows,[]);
});
