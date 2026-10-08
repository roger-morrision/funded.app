import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { buildExpectedFeeRouterAccountPrefix, deriveFeeRouter, deriveMintFeeLedger, deriveMintFeeRouter,
  FEE_ROUTER_POLICY_HASH_HEX, MINT_FEE_ROUTER_MAGIC } from '../fee-router.js';
import { deriveMintClaim } from '../server/mint-router-payout.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('ephemeral creator signs an exact payout and local RPC verifies finalized balance deltas', async () => {
  const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const directory = await mkdtemp(join(tmpdir(), 'funded-creator-settlement-local-'));
  const storePath = join(directory, 'store.json');
  const rewardsPath = `${storePath}.automatic-rewards.json`;
  const program = Keypair.generate().publicKey;
  const programData = Keypair.generate().publicKey;
  const authority = Keypair.generate(), keeper = Keypair.generate(), creator = Keypair.generate();
  const revenue = Keypair.generate().publicKey, trade = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const collectionSignature = Keypair.generate().publicKey.toBase58();
  const requestId = `${collectionSignature}:creator`;
  const router = deriveMintFeeRouter(program, mint), legacy = deriveFeeRouter(program), ledger = deriveMintFeeLedger(program, mint);
  const dataHash = createHash('sha256').update(Buffer.from('local-program-data-fixture')).digest('hex');
  const accounts = new Map();
  const account = (address, owner, data, lamports = 1_000_000, executable = false) => {
    accounts.set(new PublicKey(address).toBase58(), { owner:new PublicKey(owner).toBase58(), data:Buffer.from(data), lamports, executable });
  };
  const executableData = Buffer.alloc(36); executableData.writeUInt32LE(2,0); programData.toBuffer().copy(executableData,4);
  account(program, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, executableData, 1_000_000, true);
  account(programData, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, Buffer.from('local-program-data-fixture'));
  const legacyData = Buffer.alloc(74); Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(legacyData);
  authority.publicKey.toBuffer().copy(legacyData,41); legacyData[73] = legacy.bump;
  account(legacy.address, program, legacyData);
  const routerData = Buffer.alloc(106); routerData.write(MINT_FEE_ROUTER_MAGIC,0);
  routerData[8] = 2; Buffer.from(FEE_ROUTER_POLICY_HASH_HEX,'hex').copy(routerData,9);
  authority.publicKey.toBuffer().copy(routerData,41); mint.toBuffer().copy(routerData,73); routerData[105] = router.bump;
  account(router.address, program, routerData, 500_000_000);
  const ledgerData = Buffer.alloc(89);
  createHash('sha256').update('account:MintFeeLedger').digest().copy(ledgerData,0,0,8);
  mint.toBuffer().copy(ledgerData,8); creator.publicKey.toBuffer().copy(ledgerData,40); ledgerData[88] = ledger.bump;
  account(ledger.address, program, ledgerData);
  account(creator.publicKey, PublicKey.default, Buffer.alloc(0), 100_000_000);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transactions = new Map();
  const rpc = createHttpServer(async (req,res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { id, method, params = [] } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let result;
    try {
      if (method === 'getAccountInfo') {
        const row = accounts.get(params[0]);
        result = { context:{ slot:1 }, value:row ? { owner:row.owner, data:[row.data.toString('base64'),'base64'],
          lamports:row.lamports, executable:row.executable, rentEpoch:0 } : null };
      } else if (method === 'getLatestBlockhash') result = { context:{ slot:1 }, value:{ blockhash, lastValidBlockHeight:1000 } };
      else if (method === 'isBlockhashValid') result = { context:{ slot:1 }, value:true };
      else if (method === 'sendTransaction') {
        const transaction = Transaction.from(Buffer.from(params[0],'base64'));
        assert.equal(transaction.verifySignatures(), true);
        assert.equal(transaction.instructions.length, 1);
        const instruction = transaction.instructions[0];
        assert.equal(instruction.programId.toBase58(), program.toBase58());
        assert.equal(instruction.keys[1].pubkey.toBase58(), creator.publicKey.toBase58());
        const claimId = instruction.data.subarray(8,40);
        const claim = deriveMintClaim(program,mint,claimId);
        const amount = Number(instruction.data.readBigUInt64LE(44));
        assert.equal(amount,20_000_000);
        const claimData = Buffer.alloc(121);
        createHash('sha256').update('account:MintClaimRecord').digest().copy(claimData,0,0,8);
        claimId.copy(claimData,8); mint.toBuffer().copy(claimData,40);
        creator.publicKey.toBuffer().copy(claimData,72); claimData.writeBigUInt64LE(BigInt(amount),104); claimData[120] = 0;
        account(claim, program, claimData);
        const routerBefore = accounts.get(router.address.toBase58()).lamports;
        const creatorBefore = accounts.get(creator.publicKey.toBase58()).lamports;
        accounts.get(router.address.toBase58()).lamports -= amount;
        accounts.get(creator.publicKey.toBase58()).lamports += amount;
        const signature = bs58.encode(transaction.signature);
        const compiled = transaction.compileMessage();
        const keys = compiled.accountKeys.map(key => key.toBase58());
        const preBalances = keys.map(key => key === router.address.toBase58() ? routerBefore
          : key === creator.publicKey.toBase58() ? creatorBefore : accounts.get(key)?.lamports || 0);
        const postBalances = keys.map(key => accounts.get(key)?.lamports || 0);
        transactions.set(signature,{ signature, keys, header:compiled.header,
          instructions:compiled.instructions, preBalances, postBalances });
        result = signature;
      } else if (method === 'getSignatureStatuses') result = { context:{ slot:1 },
        value:params[0].map(signature => transactions.has(signature)
          ? { slot:1, confirmations:null, err:null, confirmationStatus:'finalized' } : null) };
      else if (method === 'getTransaction') {
        const row = transactions.get(params[0]);
        result = row ? { slot:1, blockTime:1, version:'legacy',
          transaction:{ signatures:[row.signature], message:{ accountKeys:row.keys, header:row.header,
            recentBlockhash:blockhash, instructions:row.instructions } },
          meta:{ err:null, fee:5000, preBalances:row.preBalances, postBalances:row.postBalances,
            innerInstructions:[], preTokenBalances:[], postTokenBalances:[], logMessages:[] } } : null;
      } else throw new Error(`Unexpected RPC method ${method}`);
      res.writeHead(200,{ 'content-type':'application/json' }); res.end(JSON.stringify({ jsonrpc:'2.0', id, result }));
    } catch (error) {
      res.writeHead(200,{ 'content-type':'application/json' });
      res.end(JSON.stringify({ jsonrpc:'2.0', id, error:{ code:-32000, message:String(error.message || error) } }));
    }
  });
  const rpcPort = await listen(rpc);
  await writeFile(storePath, JSON.stringify({
    launches:{ [mint.toBase58()]:{ mint:mint.toBase58(), creatorWallet:creator.publicKey.toBase58(),
      creator:router.address.toBase58(), cluster:'devnet', onchainVerified:true,
      pumpFeeRoute:{ router:router.address.toBase58(), scope:'per-mint-v2' } } },
    collections:{ [collectionSignature]:{ mint:mint.toBase58(), router:router.address.toBase58(), cluster:'devnet',
      status:'collected', attribution:'mint-verified', onchainVerified:true } },
    settlements:{ [collectionSignature]:{ creatorDestinations:{ creatorWallet:0.02 } } },
  }));
  await writeFile(rewardsPath, JSON.stringify({ version:2, fundingRequests:{
    [requestId]:{ id:requestId, mint:mint.toBase58(), sourceSignature:collectionSignature, kind:'creator', asset:'SOL',
      recipient:creator.publicKey.toBase58(), amount:'20000000', status:'claimable' },
  } }));
  const probe = createHttpServer();
  const apiPort = await listen(probe);
  await new Promise(resolve=>probe.close(resolve));
  const base = `http://127.0.0.1:${apiPort}`;
  const api = spawn(process.execPath, ['server/index.mjs'], { cwd:process.cwd(), stdio:'ignore', env:{
    ...process.env, PORT:String(apiPort), FUNDED_STORE_PATH:storePath, CORS_ORIGIN:base, NODE_ENV:'test',
    VITE_SOLANA_CLUSTER:'devnet', SOLANA_RPC_URL:`http://127.0.0.1:${rpcPort}`,
    FUNDED_FEE_ROUTER_PROGRAM_ID:program.toBase58(), FUNDED_REWARD_PROGRAM_DATA_SHA256:dataHash,
    FUNDED_MINT_FEE_ROUTER_ENABLED:'true', SOLANA_KEEPER_CONFIGURED:'true',
    SOLANA_KEEPER_KEYPAIR_PATH:'', FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'', DATABASE_URL:'',
    SOLANA_KEEPER_SECRET_KEY:bs58.encode(keeper.secretKey), FUNDED_ROUTER_AUTHORITY_SECRET_KEY:bs58.encode(authority.secretKey),
    FUNDED_PUMP_REVENUE_WALLET:revenue.toBase58(), FUNDED_TRADE_FEE_OWNER:trade.toBase58(),
  } });
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`,{ method:'POST', headers:{ origin:base, 'content-type':'application/json' }, body:JSON.stringify(body) });
    return { status:response.status, data:await response.json() };
  };
  try {
    let healthy = false;
    for (let attempt=0;attempt<50;attempt++) {
      try { healthy = (await fetch(`${base}/api/health`)).ok; if (healthy) break; } catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(healthy,true);
    const path = `/api/tokens/${mint.toBase58()}/creator-claim`;
    const prepared = await post(`${path}/prepare`,{});
    assert.equal(prepared.status,200,JSON.stringify(prepared.data));
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(prepared.data.statement),creator.secretKey));
    const requested = await post(`${path}/request`,{ challengeId:prepared.data.challengeId, signature });
    assert.equal(requested.status,202,JSON.stringify(requested.data));
    assert.deepEqual(requested.data.requestIds,[requestId]);
    const unknown = await post(`${path}/settle`,{ requestId:'different:creator' });
    assert.equal(unknown.status,404);
    const review = await post(`${path}/settle`,{ requestId });
    assert.equal(review.status,202,JSON.stringify(review.data));
    const transaction = Transaction.from(Buffer.from(review.data.transaction,'base64'));
    transaction.partialSign(creator);
    const settled = await post(`${path}/settle`,{ requestId,
      creatorSignedTransaction:transaction.serialize({ requireAllSignatures:false, verifySignatures:false }).toString('base64') });
    assert.equal(settled.status,200,JSON.stringify(settled.data));
    assert.equal(settled.data.status,'paid');
    const replay = await post(`${path}/settle`,{ requestId });
    assert.equal(replay.status,200);
    assert.equal(replay.data.signature,settled.data.signature);
    const final = JSON.parse(await readFile(rewardsPath,'utf8')).fundingRequests[requestId];
    assert.equal(final.status,'paid-via-creator-settlement');
    assert.equal(final.balanceDeltaVerified,true);
    assert.equal(accounts.get(router.address.toBase58()).lamports,480_000_000);
    assert.equal(accounts.get(creator.publicKey.toBase58()).lamports,120_000_000);
  } finally {
    api.kill();
    await new Promise(resolve=>rpc.close(resolve));
    await rm(directory,{ recursive:true, force:true });
  }
});
