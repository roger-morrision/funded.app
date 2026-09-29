import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Transaction } from '@solana/web3.js';

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
  const expectedMessage = expected.serializeMessage();
  const signedMessage = signed.serializeMessage();
  if (signedMessage.length !== expectedMessage.length || signedMessage.some((byte, index) => byte !== expectedMessage[index])) throw new Error('Phantom returned a different transaction. Nothing was submitted.');
  const signature = signed.signatures.find(entry => entry.publicKey.toBase58() === publicKey)?.signature;
  if (!signature || !nacl.sign.detached.verify(expectedMessage, signature, bs58.decode(publicKey))) throw new Error('Phantom did not sign with the connected wallet. Nothing was submitted.');
  return signed;
}

export function verifyPhantomMobileSignature(message, encodedSignature, publicKey){
  const signature = bs58.decode(encodedSignature || '');
  if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(message, signature, bs58.decode(publicKey))) throw new Error('Phantom signature does not match the connected wallet.');
  return signature;
}
