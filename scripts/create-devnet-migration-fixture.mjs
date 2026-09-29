import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { devnetMetadataUri, metadataStatement } from '../devnet-metadata.js';
import { verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';

assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet');
assert.notEqual(process.env.VITE_ALLOW_MAINNET, 'true');
const creator = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY || ''));
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
assert.equal(await connection.getGenesisHash(), await new Connection(clusterApiUrl('devnet')).getGenesisHash());
const router = await verifyFeeRouterAccount({ connection, programId });
assert.equal(router.verified, true, 'Shared Devnet router is unverified.');
const balance = await connection.getBalance(creator.publicKey, 'finalized');
assert(balance >= 3_100_000_000, 'Issuer lacks the bounded launch and migration Devnet budget.');
console.log(JSON.stringify({ stage:'preflight', execute:process.argv.includes('--execute'), creator:creator.publicKey.toBase58(), balanceSol:balance / 1e9, appRegistration:false, communityPromise:false }));
if (!process.argv.includes('--execute')) process.exit(0);

const journalPath = `audit-records/isolated-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
mkdirSync('audit-records', { recursive:true });
function journal(row) { const value = { at:new Date().toISOString(), ...row }; appendFileSync(journalPath, `${JSON.stringify(value)}\n`); console.log(JSON.stringify(value)); }
const suffix = Date.now().toString(36).slice(-6);
const name = `Migration Fixture ${suffix}`;
const symbol = 'MIGQA';
function sign(statement) { return bs58.encode(nacl.sign.detached(new TextEncoder().encode(statement), creator.secretKey)); }

try {
  const launch = await submitPumpDevnetLaunch({
    connection,
    provider:{ signTransaction:async transaction => { transaction.partialSign(creator); return transaction; } },
    payer:creator.publicKey,
    input:{ name, symbol, supply:1_000_000_000, decimals:6, initialBuyPercent:0 },
    feeRouterAddress:router.address.toBase58(), feeRouterProgramId:programId, useMintRouter:true,
    prepareMetadata:async ({ mint }) => {
      const record = { mint, creatorWallet:creator.publicKey.toBase58(), name, symbol,
        description:'Isolated Devnet migration fixture. No community allocation or claim.',
        tagline:'Migration mechanics QA only', roadmap:'', website:'', x:'', telegram:'', discord:'', imageSha256:'' };
      const response = await fetch('http://127.0.0.1:8788/api/devnet-metadata', {
        method:'POST', headers:{ 'content-type':'application/json', origin:'https://funded.vip' },
        body:JSON.stringify({ ...record, imageBase64:'', imageType:'', signature:sign(metadataStatement(record)) }),
        signal:AbortSignal.timeout(15_000),
      });
      const saved = await response.json();
      assert.equal(response.status, 201, `Metadata publication failed: ${saved.error || response.status}`);
      assert.equal(saved.uri, devnetMetadataUri(mint));
      journal({ stage:'metadata-published', mint, uri:saved.uri });
      return saved.uri;
    },
    onJournal:event => journal({ stage:'launch-transaction', ...event }),
  });
  const mint = (launch.mint.publicKey || launch.mint).toBase58();
  const status = await connection.getSignatureStatus(launch.signature, { searchTransactionHistory:true });
  assert.equal(status.value?.confirmationStatus, 'finalized');
  assert.equal(status.value?.err, null);
  const verified = await verifyMintFeeRouterAccount({ connection, programId, mint, expectedAuthority:creator.publicKey });
  assert.equal(verified.verified, true);
  const response = await fetch('http://127.0.0.1:8788/api/launches');
  const registered = await response.json();
  assert(!registered.some(row => row.mint === mint), 'Isolated fixture must not have an app community promise.');
  journal({ stage:'isolated-launch-finalized', mint, signature:launch.signature, router:verified.address.toBase58(), journalPath });
} catch (error) {
  journal({ stage:'blocked', reason:String(error.message || error), journalPath });
  process.exitCode = 1;
}
