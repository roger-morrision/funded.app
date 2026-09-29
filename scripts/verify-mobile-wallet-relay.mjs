import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { createMobileWalletRelay } from '../server/mobile-wallet-relay.mjs';
import { createPhantomSignMessageRequest, createPhantomSignTransactionRequest, decryptPhantomMobileResult, inspectPhantomTradeTransaction, verifyPhantomMobileSession, verifyPhantomMobileSignature, verifyPhantomMobileTransaction } from '../phantom-mobile-crypto.js';

const origin = 'https://funded.vip';
let clock = 0;
let finalizedTrade = null;
const refreshedBlockhash = bs58.encode(nacl.randomBytes(32));
const relay = createMobileWalletRelay({ appOrigin:origin, now:() => clock, getLatestBlockhash:async () => ({ blockhash:refreshedBlockhash, lastValidBlockHeight:500 }), getFinalizedTransaction:async () => finalizedTrade });
const id = 'a'.repeat(48), pollToken = 'b'.repeat(64);
async function call(method, path, { headers = {}, input } = {}) {
  const result = { status:0, headers:{}, body:'' };
  const response = { writeHead(status, values){ result.status=status; result.headers=values; }, end(value=''){ result.body=value; } };
  const handled = await relay.handle({ method, headers }, response, new URL(path, origin), async () => input);
  return { handled, ...result, json:result.headers['content-type']?.includes('json') ? JSON.parse(result.body) : null };
}

assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin:'https://evil.example' }, input:{ id,pollToken } })).status, 403);
const registered = await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id,pollToken } });
assert.equal(registered.status, 201);
assert.equal(registered.json.callbackUrl, `${origin}/api/mobile-wallet/callback/${id}`);
assert.equal((await call('GET', `/api/mobile-wallet/callback/${id}`)).status, 200);
assert.equal((await call('GET', `/api/mobile-wallet/relay/${id}`)).status, 404);
assert.deepEqual((await call('GET', `/api/mobile-wallet/relay/${id}`, { headers:{ 'x-mobile-wallet-token':pollToken } })).json, { status:'pending' });
assert.equal((await call('GET', `/api/mobile-wallet/callback/${id}?data=not-base58&nonce=12`)).status, 400);
const ciphertext = bs58.encode(nacl.randomBytes(80)), nonce = bs58.encode(nacl.randomBytes(24)), phantomPublicKey = bs58.encode(nacl.box.keyPair().publicKey);
assert.equal((await call('GET', `/api/mobile-wallet/callback/${id}?data=${ciphertext}&nonce=${nonce}&phantom_encryption_public_key=${phantomPublicKey}`)).status, 200);
assert.deepEqual((await call('GET', `/api/mobile-wallet/relay/${id}`, { headers:{ 'x-mobile-wallet-token':pollToken } })).json, { status:'complete', result:{ data:ciphertext, nonce, phantom_encryption_public_key:phantomPublicKey } });
assert.equal((await call('GET', `/api/mobile-wallet/callback/${id}?errorCode=4001`)).status, 400);
clock = 300_001;
assert.equal((await call('GET', `/api/mobile-wallet/relay/${id}`, { headers:{ 'x-mobile-wallet-token':pollToken } })).status, 404);

const mobileWallet = nacl.sign.keyPair();
const signId = 'c'.repeat(48), signToken = 'd'.repeat(64);
const signMessage = 'funded.app SOL claim test for @tester nonce abc';
const signRequest = { publicKey:bs58.encode(mobileWallet.publicKey), message:signMessage };
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:signId, pollToken:signToken, signRequest:{ ...signRequest, publicKey:'bad' } } })).status, 400);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:signId, pollToken:signToken, signRequest } })).status, 201);
assert.equal((await call('GET', `/api/mobile-wallet/sign/${signId}`)).status, 200);
assert.deepEqual((await call('GET', `/api/mobile-wallet/sign-request/${signId}`)).json, signRequest);
const mobileSignature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(signMessage), mobileWallet.secretKey)).toString('base64');
assert.equal((await call('POST', `/api/mobile-wallet/sign/${signId}`, { headers:{ origin:'https://evil.example' }, input:{ signature:mobileSignature } })).status, 403);
assert.equal((await call('POST', `/api/mobile-wallet/sign/${signId}`, { headers:{ origin }, input:{ signature:Buffer.from(nacl.sign.detached(new TextEncoder().encode(signMessage), nacl.sign.keyPair().secretKey)).toString('base64') } })).status, 400);
assert.equal((await call('POST', `/api/mobile-wallet/sign/${signId}`, { headers:{ origin }, input:{ signature:mobileSignature } })).status, 200);
const signedFlow = (await call('GET', `/api/mobile-wallet/relay/${signId}`, { headers:{ 'x-mobile-wallet-token':signToken } })).json;
assert.equal(signedFlow.status, 'complete');
assert.equal(signedFlow.result.signature, bs58.encode(Buffer.from(mobileSignature, 'base64')));
assert.equal((await call('POST', `/api/mobile-wallet/sign/${signId}`, { headers:{ origin }, input:{ signature:mobileSignature } })).status, 404);

const wallet = nacl.sign.keyPair(), dapp = nacl.box.keyPair(), phantom = nacl.box.keyPair();
const sessionData = { app_url:origin, chain:'solana', cluster:'devnet', timestamp:1 };
const session = { publicKey:bs58.encode(wallet.publicKey), session:bs58.encode(nacl.sign(new TextEncoder().encode(JSON.stringify(sessionData)),wallet.secretKey)), secretKey:bs58.encode(dapp.secretKey), phantomPublicKey:bs58.encode(phantom.publicKey) };
assert.equal(verifyPhantomMobileSession(session, origin), session);
assert.throws(() => verifyPhantomMobileSession({ ...session, publicKey:bs58.encode(nacl.sign.keyPair().publicKey) }, origin), /ownership/);
assert.throws(() => verifyPhantomMobileSession(session, 'https://other.example'), /Devnet app/);
const message = new TextEncoder().encode('funded.vip Devnet claim');
const signed = createPhantomSignMessageRequest(session, message, `${origin}/api/mobile-wallet/callback/${id}`);
const link = new URL(signed.link);
assert.equal(link.pathname, '/ul/v1/signMessage');
const parameters = link.searchParams;
const phantomSharedSecret = nacl.box.before(dapp.publicKey,phantom.secretKey);
const request = JSON.parse(new TextDecoder().decode(nacl.box.open.after(bs58.decode(parameters.get('payload')),bs58.decode(parameters.get('nonce')),phantomSharedSecret)));
assert.equal(request.message, bs58.encode(message));
assert.equal(request.session,session.session);
const signature = bs58.encode(nacl.sign.detached(message,wallet.secretKey));
const responseNonce = nacl.randomBytes(nacl.box.nonceLength);
const response = { nonce:bs58.encode(responseNonce), data:bs58.encode(nacl.box.after(new TextEncoder().encode(JSON.stringify({ signature })),responseNonce,phantomSharedSecret)) };
assert.equal(bs58.encode(verifyPhantomMobileSignature(message,decryptPhantomMobileResult(response,signed.sharedSecret).signature,session.publicKey)),signature);
assert.throws(() => verifyPhantomMobileSignature(message,bs58.encode(nacl.sign.detached(message,nacl.sign.keyPair().secretKey)),session.publicKey), /does not match/);
const payer = Keypair.fromSecretKey(wallet.secretKey);
const destination = Keypair.generate().publicKey;
const transaction = new Transaction({ feePayer:payer.publicKey, recentBlockhash:bs58.encode(nacl.randomBytes(32)) }).add(SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:destination, lamports:1 }));
const tradeRequest = createPhantomSignTransactionRequest(session, transaction, `${origin}/api/mobile-wallet/callback/${id}`);
const tradeLink = new URL(tradeRequest.link);
assert.equal(tradeLink.pathname, '/ul/v1/signTransaction');
const tradeId = 'e'.repeat(48), tradeToken = 'f'.repeat(64);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:tradeId, pollToken:tradeToken } })).status, 201);
const linkPath = `/api/mobile-wallet/link/${tradeId}`;
const tradeCallback = `${origin}/api/mobile-wallet/callback/${tradeId}`;
const shortTradeRequest = createPhantomSignTransactionRequest(session, transaction, tradeCallback);
assert.equal((await call('POST', linkPath, { headers:{ origin, 'x-mobile-wallet-token':'0'.repeat(64) }, input:{ link:shortTradeRequest.link } })).status, 404);
assert.equal((await call('POST', linkPath, { headers:{ origin, 'x-mobile-wallet-token':tradeToken }, input:{ link:'https://evil.example/ul/v1/signTransaction' } })).status, 400);
assert.equal((await call('POST', linkPath, { headers:{ origin, 'x-mobile-wallet-token':tradeToken }, input:{ link:tradeRequest.link } })).status, 400);
assert.equal((await call('POST', linkPath, { headers:{ origin, 'x-mobile-wallet-token':tradeToken }, input:{ link:shortTradeRequest.link } })).json.openUrl, `${origin}/api/mobile-wallet/open/${tradeId}`);
assert.equal((await call('GET', `/api/mobile-wallet/open/${tradeId}`)).headers.location, shortTradeRequest.link);
const tradePayload = JSON.parse(new TextDecoder().decode(nacl.box.open.after(bs58.decode(tradeLink.searchParams.get('payload')),bs58.decode(tradeLink.searchParams.get('nonce')),phantomSharedSecret)));
assert.equal(tradePayload.session, session.session);
assert.deepEqual(Transaction.from(bs58.decode(tradePayload.transaction)).serializeMessage(), transaction.serializeMessage());
const signedTransaction = Transaction.from(bs58.decode(tradePayload.transaction));
signedTransaction.sign(payer);
const encodedSigned = bs58.encode(signedTransaction.serialize());
const fallbackId = '1'.repeat(48), fallbackToken = '2'.repeat(64);
const transactionRequest = { publicKey:session.publicKey, transaction:Buffer.from(transaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64') };
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:fallbackId, pollToken:fallbackToken, transactionRequest:{ ...transactionRequest, publicKey:bs58.encode(Keypair.generate().publicKey.toBytes()) } } })).status, 400);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:fallbackId, pollToken:fallbackToken, transactionRequest } })).status, 201);
assert.equal((await call('GET', '/api/mobile-wallet/web3.js')).status, 200);
const tradePage = await call('GET', `/api/mobile-wallet/trade/${fallbackId}`);
assert.equal(tradePage.status, 200);
const inlineSigner = tradePage.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineSigner);
assert.doesNotThrow(() => new Function(inlineSigner));
assert.deepEqual((await call('GET', `/api/mobile-wallet/trade-request/${fallbackId}`)).json, transactionRequest);
assert.equal((await call('POST', `/api/mobile-wallet/trade/${fallbackId}`, { headers:{ origin:'https://evil.example' }, input:{ transaction:Buffer.from(signedTransaction.serialize()).toString('base64') } })).status, 403);
const tradeResponseNonce = nacl.randomBytes(nacl.box.nonceLength);
const tradeResponse = { nonce:bs58.encode(tradeResponseNonce), data:bs58.encode(nacl.box.after(new TextEncoder().encode(JSON.stringify({ transaction:encodedSigned })),tradeResponseNonce,phantomSharedSecret)) };
assert.deepEqual(verifyPhantomMobileTransaction(transaction,decryptPhantomMobileResult(tradeResponse,tradeRequest.sharedSecret).transaction,session.publicKey).serialize(),signedTransaction.serialize());
const changed = new Transaction({ feePayer:payer.publicKey, recentBlockhash:transaction.recentBlockhash }).add(SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:destination, lamports:2 }));
changed.sign(payer);
assert.throws(() => verifyPhantomMobileTransaction(transaction,bs58.encode(changed.serialize()),session.publicKey), /different transaction/);
assert.throws(() => verifyPhantomMobileTransaction(transaction,tradePayload.transaction,session.publicKey), /did not sign/);
const changedResponse = await call('POST', `/api/mobile-wallet/trade/${fallbackId}`, { headers:{ origin }, input:{ transaction:Buffer.from(changed.serialize()).toString('base64') } });
assert.equal(changedResponse.status, 400);
assert.equal(changedResponse.json.code, 'instructions-changed');
assert.equal((await call('POST', `/api/mobile-wallet/trade/${fallbackId}`, { headers:{ origin }, input:{ transaction:Buffer.from(transaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64') } })).json.code, 'wallet-signature-missing');
assert.equal((await call('POST', `/api/mobile-wallet/trade/${fallbackId}`, { headers:{ origin }, input:{ transaction:Buffer.from(signedTransaction.serialize()).toString('base64') } })).status, 200);
assert.equal((await call('GET', `/api/mobile-wallet/relay/${fallbackId}`, { headers:{ 'x-mobile-wallet-token':fallbackToken } })).json.result.transaction, encodedSigned);
assert.equal((await call('POST', `/api/mobile-wallet/trade/${fallbackId}`, { headers:{ origin }, input:{ transaction:Buffer.from(signedTransaction.serialize()).toString('base64') } })).status, 404);
const summaryId = 'b'.repeat(48), summaryToken = '0'.repeat(64);
const summary = { side:'sell', mint:destination.toBase58(), tokenName:'Funded Clean QA', tokenSymbol:'FCQA', tokenAmount:'10000000', expectedSol:'0.011675144', minimumSol:'0.011557806', appFeeSol:'0.000058670' };
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:summaryId, pollToken:summaryToken, transactionRequest:{ ...transactionRequest, summary:{ ...summary, minimumSol:'100' } } } })).status, 400);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:summaryId, pollToken:summaryToken, transactionRequest:{ ...transactionRequest, summary } } })).status, 201);
assert.deepEqual((await call('GET', `/api/mobile-wallet/trade-request/${summaryId}`)).json.summary, summary);
assert.match((await call('GET', `/api/mobile-wallet/trade/${summaryId}`)).body, /Token and quantity[\s\S]*Estimated SOL to wallet/);
assert.equal((await call('GET', `/api/mobile-wallet/trade-status/${summaryId}`)).json.status, 'review');
assert.equal((await call('POST', `/api/mobile-wallet/trade/${summaryId}`, { headers:{ origin }, input:{ transaction:Buffer.from(signedTransaction.serialize()).toString('base64') } })).status, 200);
assert.equal((await call('GET', `/api/mobile-wallet/trade-status/${summaryId}`)).json.status, 'signed');
const expectedTradeSignature = bs58.encode(signedTransaction.signature);
assert.equal((await call('POST', `/api/mobile-wallet/trade-status/${summaryId}`, { headers:{ origin:'https://evil.example', 'x-mobile-wallet-token':summaryToken }, input:{ signature:expectedTradeSignature } })).status, 404);
assert.equal((await call('POST', `/api/mobile-wallet/trade-status/${summaryId}`, { headers:{ origin, 'x-mobile-wallet-token':summaryToken }, input:{ signature:bs58.encode(nacl.randomBytes(64)) } })).status, 400);
assert.equal((await call('POST', `/api/mobile-wallet/trade-status/${summaryId}`, { headers:{ origin, 'x-mobile-wallet-token':summaryToken }, input:{ signature:expectedTradeSignature } })).json.status, 'submitted');
assert.equal((await call('GET', `/api/mobile-wallet/trade-status/${summaryId}`)).json.status, 'submitted');
finalizedTrade = { slot:505481324, transaction:{ message:{ accountKeys:[{ pubkey:payer.publicKey }] } }, meta:{ err:null, preBalances:[1_000_000_000], postBalances:[1_011_000_000], preTokenBalances:[{ owner:session.publicKey, mint:summary.mint, uiTokenAmount:{ amount:'10000000000000', decimals:6 } }], postTokenBalances:[{ owner:session.publicKey, mint:summary.mint, uiTokenAmount:{ amount:'0', decimals:6 } }] } };
clock += 3001;
const finalizedStatus = (await call('GET', `/api/mobile-wallet/trade-status/${summaryId}`)).json;
assert.equal(finalizedStatus.status, 'finalized');
assert.equal(finalizedStatus.solDeltaLamports, '11000000');
assert.equal(finalizedStatus.tokenDeltaRaw, '-10000000000000');
assert.equal(finalizedStatus.tokenDecimals, 6);
const phantomBudget = new Transaction({ feePayer:payer.publicKey, recentBlockhash:transaction.recentBlockhash }).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units:300_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports:1_000 }),
  ...transaction.instructions,
);
phantomBudget.sign(payer);
assert.deepEqual(inspectPhantomTradeTransaction(transaction, phantomBudget), { ok:true, priorityFeeLamports:300 });
assert.deepEqual(verifyPhantomMobileTransaction(transaction, bs58.encode(phantomBudget.serialize()), session.publicKey).serialize(), phantomBudget.serialize());
const budgetId = '7'.repeat(48), budgetToken = '8'.repeat(64);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:budgetId, pollToken:budgetToken, transactionRequest } })).status, 201);
assert.equal((await call('POST', `/api/mobile-wallet/trade/${budgetId}`, { headers:{ origin }, input:{ transaction:Buffer.from(phantomBudget.serialize()).toString('base64') } })).status, 200);
assert.equal((await call('GET', `/api/mobile-wallet/relay/${budgetId}`, { headers:{ 'x-mobile-wallet-token':budgetToken } })).json.result.transaction, bs58.encode(phantomBudget.serialize()));
const expensiveBudget = new Transaction({ feePayer:payer.publicKey, recentBlockhash:transaction.recentBlockhash }).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units:300_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports:1_000_000 }),
  ...transaction.instructions,
);
expensiveBudget.sign(payer);
assert.equal(inspectPhantomTradeTransaction(transaction, expensiveBudget).code, 'priority-fee-too-high');
assert.throws(() => verifyPhantomMobileTransaction(transaction, bs58.encode(expensiveBudget.serialize()), session.publicKey), /priority-fee-too-high/);
const expensiveId = '9'.repeat(48), expensiveToken = 'a'.repeat(64);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:expensiveId, pollToken:expensiveToken, transactionRequest } })).status, 201);
assert.equal((await call('POST', `/api/mobile-wallet/trade/${expensiveId}`, { headers:{ origin }, input:{ transaction:Buffer.from(expensiveBudget.serialize()).toString('base64') } })).json.code, 'priority-fee-too-high');
const changedBudget = new Transaction({ feePayer:payer.publicKey, recentBlockhash:transaction.recentBlockhash }).add(
  ComputeBudgetProgram.setComputeUnitLimit({ units:300_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports:1_000 }),
  ...changed.instructions,
);
changedBudget.sign(payer);
assert.equal(inspectPhantomTradeTransaction(transaction, changedBudget).code, 'instructions-changed');
const malformedBudget = new Transaction({ feePayer:payer.publicKey, recentBlockhash:transaction.recentBlockhash }).add(
  ComputeBudgetProgram.requestHeapFrame({ bytes:32_768 }),
  ...transaction.instructions,
);
malformedBudget.sign(payer);
assert.equal(inspectPhantomTradeTransaction(transaction, malformedBudget).code, 'unsafe-compute-budget');
const refreshedId = '3'.repeat(48), refreshedToken = '4'.repeat(64);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:refreshedId, pollToken:refreshedToken, transactionRequest } })).status, 201);
assert.equal((await call('POST', `/api/mobile-wallet/trade-refresh/${refreshedId}`, { headers:{ origin:'https://evil.example' } })).status, 403);
const refreshed = await call('POST', `/api/mobile-wallet/trade-refresh/${refreshedId}`, { headers:{ origin } });
assert.equal(refreshed.status, 200);
const refreshedTransaction = Transaction.from(Buffer.from(refreshed.json.transaction, 'base64'));
assert.equal(refreshedTransaction.recentBlockhash, refreshedBlockhash);
assert.notDeepEqual(refreshedTransaction.serializeMessage(), transaction.serializeMessage());
refreshedTransaction.sign(payer);
const staleResponse = await call('POST', `/api/mobile-wallet/trade/${refreshedId}`, { headers:{ origin }, input:{ transaction:Buffer.from(signedTransaction.serialize()).toString('base64') } });
assert.equal(staleResponse.status, 400);
assert.equal(staleResponse.json.code, 'blockhash-changed');
assert.equal((await call('POST', `/api/mobile-wallet/trade/${refreshedId}`, { headers:{ origin }, input:{ transaction:Buffer.from(refreshedTransaction.serialize()).toString('base64') } })).status, 200);
const refreshedResult = (await call('GET', `/api/mobile-wallet/relay/${refreshedId}`, { headers:{ 'x-mobile-wallet-token':refreshedToken } })).json.result;
assert.equal(refreshedResult.blockhash, refreshedBlockhash);
assert.equal(refreshedResult.lastValidBlockHeight, 500);
assert.deepEqual(verifyPhantomMobileTransaction(transaction, refreshedResult.transaction, session.publicKey, refreshedResult.blockhash).serialize(), refreshedTransaction.serialize());
assert.throws(() => verifyPhantomMobileTransaction(transaction, refreshedResult.transaction, session.publicKey), /different transaction/);
const mintSigner = Keypair.generate();
const launchTransaction = new Transaction({ feePayer:payer.publicKey, recentBlockhash:bs58.encode(nacl.randomBytes(32)) })
  .add(SystemProgram.transfer({ fromPubkey:mintSigner.publicKey, toPubkey:destination, lamports:1 }));
launchTransaction.partialSign(mintSigner);
const launchRequest = { publicKey:session.publicKey, transaction:Buffer.from(launchTransaction.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64'), lastValidBlockHeight:700 };
const launchId = '5'.repeat(48), launchToken = '6'.repeat(64);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:launchId, pollToken:launchToken, transactionRequest:{ ...launchRequest, lastValidBlockHeight:undefined } } })).status, 400);
const tamperedLaunch = Transaction.from(Buffer.from(launchRequest.transaction, 'base64'));
tamperedLaunch.recentBlockhash = bs58.encode(nacl.randomBytes(32));
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:launchId, pollToken:launchToken, transactionRequest:{ ...launchRequest, transaction:Buffer.from(tamperedLaunch.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64') } } })).status, 400);
assert.equal((await call('POST', '/api/mobile-wallet/relay', { headers:{ origin }, input:{ id:launchId, pollToken:launchToken, transactionRequest:launchRequest } })).status, 201);
const preserved = await call('POST', `/api/mobile-wallet/trade-refresh/${launchId}`, { headers:{ origin } });
assert.equal(preserved.status, 200);
assert.equal(preserved.json.transaction, launchRequest.transaction, 'A mint-signed launch must retain its original blockhash and signature.');
const completedLaunch = Transaction.from(Buffer.from(preserved.json.transaction, 'base64'));
completedLaunch.partialSign(payer);
assert.equal(completedLaunch.verifySignatures(), true);
assert.equal((await call('POST', `/api/mobile-wallet/trade/${launchId}`, { headers:{ origin }, input:{ transaction:Buffer.from(completedLaunch.serialize()).toString('base64') } })).status, 200);
const launchResult = (await call('GET', `/api/mobile-wallet/relay/${launchId}`, { headers:{ 'x-mobile-wallet-token':launchToken } })).json.result;
assert.equal(launchResult.lastValidBlockHeight, 700);
assert.equal(launchResult.blockhash, launchTransaction.recentBlockhash);
console.log('Mobile Phantom relay, Devnet session proof, remote message signature, and transaction signature verified.');
