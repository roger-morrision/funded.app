import { PublicKey, Connection } from '@solana/web3.js';
import { verifyFundedBurn } from '../burn-verification.mjs';
import { projectBurnMemo } from '../../funded-burn.js';
import { invalidRequest } from '../http-policy.mjs';
import { DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import { readVerifiedListingMint } from '../token-metadata.mjs';
import { listingBurnBaseUnits, listingMemo } from '../../listing-policy.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createListingPaymentsRoutes({
  body,
  fundedTokenMint,
  walletKey,
  store,
  solanaCluster,
  solanaRpcUrl,
  listingBurnAlreadyUsed,
  listingBurnTokens,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleListingPaymentsRoutes(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/burn-receipts') {
      const input = await body(req);
      const configuredMint = fundedTokenMint;
      if (!configuredMint) return json(res, 503, { error: 'The protocol $FUNDED mint is not configured.' });
      let burnWallet;
      try { burnWallet = walletKey(input.wallet); } catch { return json(res, 400, { error: 'A valid burn wallet is required.' }); }
      const signature = String(input.signature || '').trim();
      const projectMint = String(input.projectMint || '').trim() || null;
      const state = await store.read();
      const existing = state.burnReceipts?.[signature];
      if (existing) {
        if (existing.wallet !== burnWallet || existing.projectMint !== projectMint) return json(res, 409, { error: 'This burn signature is already indexed with different attribution.' });
        return json(res, 200, existing);
      }
      if (projectMint) {
        try { new PublicKey(projectMint); } catch { return json(res, 400, { error: 'The selected project mint is invalid.' }); }
        const project = state.launches?.[projectMint];
        if (!project?.onchainVerified || project.cluster !== solanaCluster) return json(res, 409, { error: 'Project attribution requires a verified launch on this cluster.' });
        if (project.creatorWallet !== burnWallet) return json(res, 403, { error: 'Only the verified project creator can attribute this burn.' });
      }
      let proof;
      try {
        proof = await verifyFundedBurn({ connection: new Connection(solanaRpcUrl, 'confirmed'), signature, fundedMint: configuredMint, wallet: burnWallet,
          amountBaseUnits: input.amountBaseUnits, expectedMemo: projectMint ? projectBurnMemo(projectMint) : null });
      } catch (error) { return json(res, 409, { error: error.message || 'The burn transaction could not be verified.' }); }
      const receipt = {
        id: `burn:${signature}`, signature, cluster: solanaCluster, wallet: burnWallet,
        fundedMint: configuredMint, projectMint, instruction: 'BurnChecked', tokenProgram: proof.tokenProgram,
        tokenAccount: proof.tokenAccount, amountBaseUnits: proof.amountBaseUnits, decimals: proof.decimals,
        amountTokens: Number(proof.amountBaseUnits) / (10 ** proof.decimals), supplyAfterBaseUnits: proof.supplyAfterBaseUnits,
        slot: proof.slot, blockTime: proof.blockTime, status: 'verified', onchainVerified: true, verifiedAt: proof.verifiedAt,
      };
      const saved = await store.update(current => {
        current.burnReceipts ||= {};
        const prior = current.burnReceipts[signature];
        if (prior && (prior.wallet !== burnWallet || prior.projectMint !== projectMint)) throw invalidRequest('This burn signature already has different attribution.');
        current.burnReceipts[signature] ||= receipt;
        return current.burnReceipts[signature];
      });
      return json(res, 201, saved);
    }

    if (req.method === 'POST' && url.pathname === '/api/listings') {
      if (solanaCluster !== 'devnet' || !fundedTokenMint) return json(res, 503, { error: 'Paid listings require a configured Solana $FUNDED mint.' });
      const input = await body(req);
      let mint, burnWallet;
      try { mint = new PublicKey(String(input.mint || '')).toBase58(); burnWallet = walletKey(input.wallet); }
      catch { return json(res, 400, { error: 'A valid token mint and paying wallet are required.' }); }
      const signature = String(input.signature || '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return json(res, 400, { error: 'A confirmed burn signature is required.' });
      const priorState = await store.read();
      const existing = priorState.listings?.[mint];
      if (existing) return existing.signature === signature && existing.wallet === burnWallet
        ? json(res, 200, existing) : json(res, 409, { error: 'This mint has already been listed with another payment.' });
      if (listingBurnAlreadyUsed(priorState, signature))
        return json(res, 409, { error: 'This burn signature has already been used.' });
      const rpc = new Connection(solanaRpcUrl, 'finalized');
      let proof, listingMetadata;
      try {
        if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH)
          return json(res, 503, { error: 'Listing payments require a Solana RPC.' });
        const [trustedLaunch, signedMetadata] = await Promise.all([store.readLaunch(mint), store.readMetadata(mint)]);
        listingMetadata = await readVerifiedListingMint(rpc, mint, { trustedLaunch, signedMetadata });
        const fundedSupply = await rpc.getTokenSupply(new PublicKey(fundedTokenMint), 'finalized');
        const amountBaseUnits = listingBurnBaseUnits(fundedSupply.value.decimals, listingBurnTokens);
        proof = await verifyFundedBurn({ connection: rpc, signature, fundedMint: fundedTokenMint, wallet: burnWallet,
          amountBaseUnits: amountBaseUnits.toString(), expectedMemo: listingMemo(mint) });
      } catch (error) { return json(res, 409, { error: error.message || 'The listing payment could not be verified on Solana.' }); }
      const record = { mint, name:listingMetadata.name, symbol:listingMetadata.symbol, wallet: burnWallet, cluster: 'devnet', signature,
        fundedMint: fundedTokenMint, amountBaseUnits: proof.amountBaseUnits, amountTokens: listingBurnTokens,
        slot: proof.slot, status: 'listed', onchainVerified: true, metadataSource:listingMetadata.source,
        metadataAddress:listingMetadata.address, listedAt: proof.verifiedAt };
      try {
        const saved = await store.update(state => {
          state.listings ||= {};
          const prior = state.listings[mint];
          if (prior) {
            if (prior.signature !== signature || prior.wallet !== burnWallet) throw new Error('This mint has already been listed.');
            return prior;
          }
          if (listingBurnAlreadyUsed(state, signature))
            throw new Error('This burn signature has already been used.');
          state.listings[mint] = record;
          return record;
        });
        return json(res, saved === record ? 201 : 200, saved);
      } catch (error) { return json(res, 409, { error: error.message || 'This listing could not be indexed.' }); }
    }
    return false;
  };
}
