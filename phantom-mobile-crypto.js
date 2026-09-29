import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Transaction } from '@solana/web3.js';

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const MAX_COMPUTE_UNITS = 1_400_000n;
const MAX_PHANTOM_PRIORITY_FEE_LAMPORTS = 100_000n;

function sameBytes(expected, actual){
  return expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
}

function sameInstruction(expected, actual){
  return Boolean(actual) && expected.programId.equals(actual.programId)
    && sameBytes(expected.data, actual.data)
    && expected.keys.length === actual.keys.length
    && expected.keys.every((key, index) => key.pubkey.equals(actual.keys[index].pubkey)
      && key.isSigner === actual.keys[index].isSigner && key.isWritable === actual.keys[index].isWritable);
}

export function inspectPhantomTradeTransaction(expected, signed){
  if (!expected.feePayer?.equals(signed.feePayer)) return { ok:false, code:'fee-payer-changed' };
  if (expected.recentBlockhash !== signed.recentBlockhash) return { ok:false, code:'blockhash-changed' };
  const added = signed.instructions.length - expected.instructions.length;
  if (added < 0 || added > 2 || (added > 0 && expected.instructions.some(instruction => instruction.programId.toBase58() === COMPUTE_BUDGET_PROGRAM))) return { ok:false, code:'instructions-changed' };
  if (!expected.instructions.every((instruction, index) => sameInstruction(instruction, signed.instructions[index + added]))) return { ok:false, code:'instructions-changed' };
  if (!added) return sameBytes(expected.serializeMessage(), signed.serializeMessage())
    ? { ok:true, priorityFeeLamports:0 } : { ok:false, code:'instructions-changed' };

  let computeUnits = MAX_COMPUTE_UNITS;
  let microLamports = 0n;
  const seen = new Set();
  for (const instruction of signed.instructions.slice(0, added)) {
    const data = instruction.data;
    const type = data[0];
    if (instruction.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM || instruction.keys.length || seen.has(type)) return { ok:false, code:'unsafe-compute-budget' };
    seen.add(type);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 2 && data.length === 5) {
      computeUnits = BigInt(view.getUint32(1, true));
      if (computeUnits < 1n || computeUnits > MAX_COMPUTE_UNITS) return { ok:false, code:'unsafe-compute-budget' };
    } else if (type === 3 && data.length === 9) {
      microLamports = view.getBigUint64(1, true);
    } else return { ok:false, code:'unsafe-compute-budget' };
  }
  const priorityFee = (computeUnits * microLamports + 999_999n) / 1_000_000n;
  if (priorityFee > MAX_PHANTOM_PRIORITY_FEE_LAMPORTS) return { ok:false, code:'priority-fee-too-high' };
  return { ok:true, priorityFeeLamports:Number(priorityFee) };
}

export function verifyPhantomMobileSession(session, appOrigin){
  const publicKey = bs58.decode(session.publicKey || '');
  const proof = publicKey.length === 32 ? nacl.sign.open(bs58.decode(session.session || ''), publicKey) : null;
  if (!proof) throw new Error('Phantom wallet ownership was not verified.');
  const fields = JSON.parse(new TextDecoder().decode(proof));
  if (new URL(fields.app_url).origin !== appOrigin || fields.chain !== 'solana' || fields.cluster !== 'devnet') throw new Error('Phantom did not approve this Devnet app.');
  if (bs58.decode(session.secretKey || '').length !== 32 || bs58.decode(session.phantomPublicKey || '').length !== 32) throw new Error('Phantom encryption keys are invalid.');
  return session;
}

export function decryptPhantomMobileResult(result, sharedSecret){
  if (result?.errorCode) throw new Error(`${result.errorMessage || 'Phantom request was cancelled.'} (code ${result.errorCode})`);
  const nonce = bs58.decode(result?.nonce || '');
  if (nonce.length !== nacl.box.nonceLength) throw new Error('Phantom returned an invalid nonce.');
  const decrypted = nacl.box.open.after(bs58.decode(result?.data || ''), nonce, sharedSecret);
  if (!decrypted) throw new Error('Could not decrypt the Phantom approval.');
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function createPhantomSignMessageRequest(session, message, callbackUrl){
  const keyPair = nacl.box.keyPair.fromSecretKey(bs58.decode(session.secretKey));
  const sharedSecret = nacl.box.before(bs58.decode(session.phantomPublicKey), keyPair.secretKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = { message:bs58.encode(message), session:session.session };
  const encrypted = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret);
  const link = new URL('https://phantom.app/ul/v1/signMessage');
  link.search = new URLSearchParams({ dapp_encryption_public_key:bs58.encode(keyPair.publicKey), nonce:bs58.encode(nonce), redirect_link:callbackUrl, payload:bs58.encode(encrypted) }).toString();
  return { link:link.toString(), sharedSecret };
}

export function createPhantomSignTransactionRequest(session, transaction, callbackUrl){
  const keyPair = nacl.box.keyPair.fromSecretKey(bs58.decode(session.secretKey));
  const sharedSecret = nacl.box.before(bs58.decode(session.phantomPublicKey), keyPair.secretKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = {
    transaction:bs58.encode(transaction.serialize({ requireAllSignatures:false, verifySignatures:false })),
    session:session.session,
  };
  const encrypted = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret);
  const link = new URL('https://phantom.app/ul/v1/signTransaction');
  link.search = new URLSearchParams({ dapp_encryption_public_key:bs58.encode(keyPair.publicKey), nonce:bs58.encode(nonce), redirect_link:callbackUrl, payload:bs58.encode(encrypted) }).toString();
  return { link:link.toString(), sharedSecret };
}

export function verifyPhantomMobileTransaction(original, encodedSigned, publicKey, refreshedBlockhash = null){
  const signed = Transaction.from(bs58.decode(encodedSigned || ''));
  const expected = Transaction.from(original.serialize({ requireAllSignatures:false, verifySignatures:false }));
  if (refreshedBlockhash) {
    if (bs58.decode(refreshedBlockhash).length !== 32) throw new Error('Phantom returned an invalid Devnet blockhash. Nothing was submitted.');
    expected.recentBlockhash = refreshedBlockhash;
  }
  const inspection = inspectPhantomTradeTransaction(expected, signed);
  if (!inspection.ok) throw new Error(`Phantom returned a different transaction (${inspection.code}). Nothing was submitted.`);
  const signedMessage = signed.serializeMessage();
  const signature = signed.signatures.find(entry => entry.publicKey.toBase58() === publicKey)?.signature;
  if (!signature || !nacl.sign.detached.verify(signedMessage, signature, bs58.decode(publicKey)) || !signed.verifySignatures()) throw new Error('Phantom did not sign with the connected wallet. Nothing was submitted.');
  return signed;
}

export function verifyPhantomMobileSignature(message, encodedSignature, publicKey){
  const signature = bs58.decode(encodedSignature || '');
  if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(message, signature, bs58.decode(publicKey))) throw new Error('Phantom signature does not match the connected wallet.');
  return signature;
}
