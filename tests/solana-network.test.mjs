import test from 'node:test';import assert from 'node:assert/strict';
import {SOLANA_GENESIS,assertRpcNetwork,solanaExplorerUrl,assertQuoteNetwork} from '../solana-network.js';
import {submitPumpDevnetLaunch} from '../launch-flow.js';
import {Keypair} from '@solana/web3.js';import nacl from 'tweetnacl';import bs58 from 'bs58';
import {metadataStatement} from '../devnet-metadata.js';import {parseSignedMetadata,publicMetadata} from '../server/devnet-metadata.mjs';
import {createMetadataPublisher} from '../server/metadata-publication.mjs';
test('RPC identity rejects the wrong network and times out without signing',async()=>{
 for(const cluster of Object.keys(SOLANA_GENESIS))assert.equal(await assertRpcNetwork({getGenesisHash:async()=>SOLANA_GENESIS[cluster]},cluster),SOLANA_GENESIS[cluster]);
 await assert.rejects(assertRpcNetwork({getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta']},'devnet'),/does not match/);
 await assert.rejects(assertRpcNetwork({getGenesisHash:()=>new Promise(()=>{})},'devnet',{timeoutMs:5}),/timed out/);
 assert.equal(solanaExplorerUrl('tx','signature','mainnet-beta'),'https://explorer.solana.com/tx/signature');
 assert.match(solanaExplorerUrl('tx','signature','devnet'),/cluster=devnet/);
});
test('a Devnet launch cannot reach router reads or the wallet through a mainnet RPC',async()=>{
 let wallet=false;const connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta']};
 await assert.rejects(submitPumpDevnetLaunch({cluster:'devnet',connection,provider:{signTransaction:()=>{wallet=true;}},input:{name:'Test',symbol:'TEST',supply:1000000000,decimals:6,reserveTokens:30000000},
  useMintRouter:true,v3FeeRouter:{programId:'approved',initialAuthority:'approved',split:{}},reserveConfig:{authority:'approved',lookupTable:'approved'}}),/RPC network does not match/);assert.equal(wallet,false);
});
test('metadata signatures cannot be replayed across networks and Mainnet rejects hosted Devnet storage',async()=>{
 const wallet=Keypair.generate(),record={mint:Keypair.generate().publicKey.toBase58(),creatorWallet:wallet.publicKey.toBase58(),name:'Network Test',symbol:'NET',imageSha256:''};
 const sign=value=>({...value,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(value)),wallet.secretKey))});
 const devnet=sign(record),mainnet=sign({...record,cluster:'mainnet-beta'});
 assert.equal(parseSignedMetadata(devnet).record.mint,record.mint);
 assert.equal(parseSignedMetadata(mainnet,{cluster:'mainnet-beta'}).record.cluster,'mainnet-beta');
 assert.throws(()=>parseSignedMetadata(mainnet),/network/);assert.throws(()=>parseSignedMetadata(devnet,{cluster:'mainnet-beta'}),/network/);
 assert.throws(()=>parseSignedMetadata({...devnet,cluster:'mainnet-beta'},{cluster:'mainnet-beta'}),/signature/);
 const publish=createMetadataPublisher({env:{METADATA_STORAGE:'hosted-devnet'}});await assert.rejects(publish({record:mainnet}),/durable/);
 assert.doesNotMatch(publicMetadata(mainnet).description,/Devnet|test/);
});

test('new quotes bind network and genesis; unbound historical quotes are Devnet-only',()=>{
 for(const cluster of Object.keys(SOLANA_GENESIS))assert.doesNotThrow(()=>assertQuoteNetwork({cluster,genesisHash:SOLANA_GENESIS[cluster]},cluster));
 assert.doesNotThrow(()=>assertQuoteNetwork({},'devnet'));
 for(const quote of [{},{cluster:'devnet',genesisHash:SOLANA_GENESIS.devnet},{cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS.devnet}])assert.throws(()=>assertQuoteNetwork(quote,'mainnet-beta'),/Quote network/);
 assert.throws(()=>assertQuoteNetwork({cluster:'mainnet-beta',genesisHash:SOLANA_GENESIS['mainnet-beta']},'devnet'),/Quote network/);
});
