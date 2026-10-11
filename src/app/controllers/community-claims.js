// Dependencies and mutable application state are read live through appState.
export function createCommunityClaimsController(appState) {
  // app-source: 333
  async function checkCommunityClaim(mintAddress, { silent = false } = {}){
    const status = document.querySelector('#airdrop-selected-status');
    if (!appState.wallet && !silent) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session) { if (!silent) status.append(document.createTextNode(' Connect a Solana wallet to check this allocation.')); return; }
    const program = appState.getAirdropPrograms().find(row => row.id === mintAddress);
    if (!program?.claimActive) { if (!silent) status.append(document.createTextNode(' Claims are not open for this token.')); return; }
    const pending = appState.communityWalletAllocations.get(mintAddress);
    if (pending && pending.wallet === session.address && pending.snapshotHash === program.snapshotHash
      && (pending.status === 'checking' || silent)) return;
    appState.updateDirectoryWalletAmount(session, program, 'checking');
    try {
      const response = await appState.apiRequest(`/api/airdrops/claims/proof?mint=${encodeURIComponent(mintAddress)}&wallet=${encodeURIComponent(session.address)}`);
      if (!appState.isWalletSessionCurrent(session)) return;
      const proof = response.data;
      if (!response.available || !proof?.status) {
        appState.updateDirectoryWalletAmount(session, program, 'unavailable');
        if (!silent && document.querySelector('#airdrop-selected-program')?.dataset.mint === mintAddress)
          status.append(document.createTextNode(` Claim proof unavailable: ${proof?.error || 'retry later'}.`));
        return;
      }
      if (proof.recipient && proof.recipient !== session.address) throw new Error('Claim proof belongs to another wallet.');
      if (proof.status === 'claimed') {
        const amount = /^\d+$/.test(String(proof.amount))
          ? await appState.formatCommunityProofAmount(mintAddress, proof.amount, session) : null;
        appState.updateDirectoryWalletAmount(session, program, 'claimed', amount);
        if (!silent && document.querySelector('#airdrop-selected-program')?.dataset.mint === mintAddress)
          status.append(document.createTextNode(' This wallet has already claimed its verified allocation.'));
        return;
      }
      if (proof.status !== 'claimable') {
        appState.updateDirectoryWalletAmount(session, program, proof.status === 'ineligible' ? 'ineligible' : 'unavailable');
        if (!silent && document.querySelector('#airdrop-selected-program')?.dataset.mint === mintAddress)
          status.append(document.createTextNode(` ${proof.reason || 'This wallet has no available allocation.'}`));
        return;
      }
      if (proof.mint !== mintAddress || proof.snapshotHash !== program.snapshotHash || !/^\d+$/.test(String(proof.amount)))
        throw new Error('Claim proof differs from the verified airdrop.');
      const amount = await appState.formatCommunityProofAmount(mintAddress, proof.amount, session);
      if (!appState.isWalletSessionCurrent(session)) return;
      appState.updateDirectoryWalletAmount(session, program, 'claimable', amount);
      if (silent || document.querySelector('#airdrop-selected-program')?.dataset.mint !== mintAddress) return;
      appState.communityClaimReview = { mint:mintAddress, wallet:session.address, amount:proof.amount, index:proof.index, at:Date.now() };
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'primary-button'; button.dataset.claimCommunityMint = mintAddress;
      button.textContent = `Review claim ${amount} ${program.symbol}`;
      status.append(document.createTextNode(' A wallet transaction is required. Your wallet pays network fees and token-account rent if needed.'),
        document.createElement('br'), button);
    } catch (error) {
      if (!appState.isWalletSessionCurrent(session)) return;
      appState.updateDirectoryWalletAmount(session, program, 'unavailable');
      throw error;
    }
  }
  // app-source-end

  async function formatCommunityProofAmount(mintAddress, amount, session){
    const { PublicKey } = await appState.getSolana();
    const mintInfo = await (await appState.getTradePreviewConnection()).getAccountInfo(new PublicKey(mintAddress), 'finalized');
    if (!appState.isWalletSessionCurrent(session)) throw new Error('Wallet changed while checking the claim.');
    if (!mintInfo || mintInfo.data.length < 45) throw new Error('Claim mint is unavailable.');
    return appState.formatTokenBaseUnits(amount, mintInfo.data[44], 4);
  }

  // app-source: 334
  async function submitCommunityClaim(mintAddress){
    const session = appState.captureWalletSession();
    const status = document.querySelector('#airdrop-selected-status');
    const review = appState.communityClaimReview;
    let submittedSignature = null, claimExecutionRequested = false, claimVerified = false;
    if (!session || !appState.canSignTransactions(session.provider) || !review || review.mint !== mintAddress
      || review.wallet !== session.address || Date.now() - review.at > 60_000) {
      status.append(document.createTextNode(' Check the allocation again before signing.'));
      return;
    }
    appState.communityClaimReview = null;
    const button = status.querySelector('[data-claim-community-mint]');
    if (button) button.disabled = true;
    appState.emitPilotSignal('claim-started');
    try {
      const response = await appState.apiRequest('/api/airdrops/claims/claim-instruction', { method:'POST',
        body:{ mint:mintAddress, wallet:session.address } });
      const claim = response.data;
      if (!response.available || !claim?.accounts || String(claim.amount) !== String(review.amount))
        throw new Error(claim?.error || 'A fresh verified claim instruction is unavailable.');
      const { PublicKey, Transaction, TransactionInstruction, getAssociatedTokenAddressSync,
        createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await appState.getSolana();
      const rpc = await appState.getTradePreviewConnection();
      const program = new PublicKey(appState.FEE_ROUTER_PROGRAM_ID), mint = new PublicKey(mintAddress);
      const recipient = new PublicKey(session.address);
      const { accounts } = claim;
      if (claim.programId !== program.toBase58() || accounts.length !== 9
        || accounts.filter(row => row.isSigner).length !== 1 || accounts[0].pubkey !== session.address || !accounts[0].isSigner
        || accounts[2].pubkey !== session.address || accounts[3].pubkey !== mintAddress)
        throw new Error('Claim instruction does not match this wallet and token.');
      const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
      if (!mintInfo || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintInfo.owner.toBase58())
        || accounts[7].pubkey !== mintInfo.owner.toBase58()) throw new Error('Claim token program differs from the verified mint.');
      const expectedDrop = appState.verifiedCommunityReserves.get(mintAddress)?.drop;
      const dropInfo = expectedDrop && await rpc.getAccountInfo(new PublicKey(expectedDrop), 'finalized');
      if (!dropInfo?.owner.equals(program) || dropInfo.data.length < 350) throw new Error('Verified claim drop is unavailable.');
      const [drop] = PublicKey.findProgramAddressSync([appState.Buffer.from('community-drop-v1'),
        dropInfo.data.subarray(8, 40), mint.toBuffer()], program);
      if (drop.toBase58() !== expectedDrop || accounts[1].pubkey !== expectedDrop) throw new Error('Claim drop differs from the verified reserve.');
      const vaultToken = getAssociatedTokenAddressSync(mint, drop, true, mintInfo.owner);
      const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, mintInfo.owner);
      const [payment] = PublicKey.findProgramAddressSync([appState.Buffer.from('community-pay-v1'), drop.toBuffer(), recipient.toBuffer()], program);
      if (accounts[4].pubkey !== vaultToken.toBase58() || accounts[5].pubkey !== recipientToken.toBase58()
        || accounts[6].pubkey !== payment.toBase58() || claim.recipientToken !== recipientToken.toBase58())
        throw new Error('Claim accounts differ from the verified recipient and vault.');
      const data = appState.Buffer.from(claim.data, 'base64');
      const discriminator = appState.Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('global:claim_community_drop'))).subarray(0, 8);
      if (!data.subarray(0, 8).equals(discriminator) || data.readBigUInt64LE(8) !== BigInt(review.amount)
        || data.readUInt32LE(16) !== review.index || data.length !== 24 + data.readUInt32LE(20) * 32)
        throw new Error('Claim data differs from the reviewed allocation.');
      const before = await rpc.getTokenAccountBalance(recipientToken, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
      appState.assertWalletSessionCurrent(session);
      const latest = await rpc.getLatestBlockhash('confirmed');
      const transaction = new Transaction({ feePayer:recipient, recentBlockhash:latest.blockhash });
      if (!await rpc.getAccountInfo(recipientToken, 'finalized')) transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(recipient, recipientToken, recipient, mint, mintInfo.owner));
      transaction.add(new TransactionInstruction({ programId:program, keys:accounts.map(row => ({
        pubkey:new PublicKey(row.pubkey), isSigner:row.isSigner, isWritable:row.isWritable })), data }));
      const signed = await session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(session);
      claimExecutionRequested = true;
      submittedSignature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight:false, maxRetries:3 });
      const confirmation = await appState.waitForSignatureConfirmation(rpc, { signature:submittedSignature,
        lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
      if (confirmation.value.err) throw new Error(`Claim transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      const after = BigInt((await rpc.getTokenAccountBalance(recipientToken, 'finalized')).value.amount);
      if (after - before !== BigInt(review.amount) || !(await rpc.getAccountInfo(payment, 'finalized'))?.owner.equals(program))
        throw new Error('Claim finalized without the exact token and payment-record deltas.');
      claimVerified = true;
      appState.emitPilotSignal('claim-verified');
      await appState.loadCommunityReserveStatuses();
      const claimedProgram = appState.getAirdropPrograms().find(row => row.id === mintAddress);
      if (claimedProgram) appState.updateDirectoryWalletAmount(session, claimedProgram, 'claimed');
      appState.renderAirdropProgramDetail(appState.getAirdropPrograms().find(row => row.id === mintAddress));
      appState.showToast('Community tokens claimed and verified on Solana');
    } catch (error) {
      if (!claimVerified) appState.emitPilotSignal(appState.pilotInterruptedSignal('claim', error, claimExecutionRequested));
      if (!appState.isWalletSessionCurrent(session)) return;
      if (submittedSignature) appState.appendPendingCommunityClaim(status, mintAddress, submittedSignature);
      else status.append(document.createTextNode(` Claim stopped: ${String(error.message || error)}`));
    } finally { if (button) button.disabled = Boolean(submittedSignature); }
  }
  // app-source-end

  // app-source: 335
  function appendPendingCommunityClaim(status, mintAddress, signature){
    const receipt = document.createElement('a');
    receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${appState.APP_EXPLORER_QUERY}`;
    receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
    receipt.textContent = 'View claim transaction ↗';
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'secondary-button';
    check.dataset.checkCommunityMint = mintAddress; check.textContent = 'Check claim status';
    status.append(document.createElement('br'), document.createTextNode('Your claim was submitted, but confirmation could not be loaded. Check its status before trying again. '), receipt, document.createTextNode(' '), check);
  }
  // app-source-end

  // app-source: 336
  async function fundCommunityReserve(mintAddress){
    const session = appState.captureWalletSession();
    const button = document.querySelector('[data-fund-community-mint]');
    const status = document.querySelector('#airdrop-selected-status');
    let submittedSignature = null;
    if (!session || !appState.canSignTransactions(session.provider)) return;
    button.disabled = true;
    try {
      const launch = appState.verifiedLaunchPolicies.find(row => row.mint === mintAddress && row.onchainVerified && row.cluster === 'devnet');
      if (!launch || launch.creatorWallet !== session.address || appState.APP_CLUSTER !== 'devnet' || appState.APP_MAINNET_READ_ONLY) throw new Error('Only the verified Solana launch creator can fund this reserve.');
      const fresh = await appState.apiRequest('/api/airdrops/reserves');
      const reserve = fresh.data?.reserves?.find(row => row.mint === mintAddress);
      if (!fresh.available || fresh.data.cluster !== 'devnet' || !reserve?.vaultInitialized || reserve.verified || reserve.creatorWallet !== session.address || reserve.status !== 'unfunded' || Number(reserve.reservedTokens) !== Number(launch.communityAirdrop?.reservedTokens)) throw new Error('Reserve state changed or the reward vault is not ready. Refresh the program details.');
      const { PublicKey, Transaction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } = await appState.getSolana();
      const rpc = await appState.getTradePreviewConnection();
      const mint = new PublicKey(mintAddress), vault = new PublicKey(reserve.vault);
      const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
      if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) || mintInfo.data.length < 45) throw new Error('Launch mint is not a finalized supported SPL mint.');
      const decimals = mintInfo.data[44];
      if (decimals > 9) throw new Error('Launch mint decimals are unsupported.');
      const amount = BigInt(reserve.reservedTokens) * 10n ** BigInt(decimals);
      const source = getAssociatedTokenAddressSync(mint, session.provider.publicKey, false, mintInfo.owner);
      const destination = getAssociatedTokenAddressSync(mint, vault, true, mintInfo.owner);
      const sourceBefore = BigInt((await rpc.getTokenAccountBalance(source, 'finalized')).value.amount);
      const destinationBefore = await rpc.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
      if (sourceBefore < amount || destinationBefore !== 0n) throw new Error('The creator wallet lacks the full reserve or the vault already contains tokens.');
      if (!appState.communityFundingPreview || appState.communityFundingPreview.mint !== mintAddress || appState.communityFundingPreview.wallet !== session.address || Date.now() - appState.communityFundingPreview.at > 60_000) {
        appState.communityFundingPreview = { mint:mintAddress, wallet:session.address, at:Date.now() };
        button.textContent = 'Sign reserve funding in wallet';
        status.append(document.createTextNode(` Review: transfer ${appState.formatTokenAmount(reserve.reservedTokens)} ${launch.symbol || 'tokens'} from your wallet to reward vault ${reserve.vault}. Your wallet also pays network and token-account rent. The transfer does not open claims.`));
        return;
      }
      appState.communityFundingPreview = null;
      appState.assertWalletSessionCurrent(session);
      const latest = await rpc.getLatestBlockhash('confirmed');
      const transaction = new Transaction({ feePayer:session.provider.publicKey, recentBlockhash:latest.blockhash }).add(
        createAssociatedTokenAccountIdempotentInstruction(session.provider.publicKey, destination, vault, mint, mintInfo.owner),
        createTransferCheckedInstruction(source, mint, destination, session.provider.publicKey, amount, decimals, [], mintInfo.owner),
      );
      const signed = await session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(session);
      submittedSignature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight:false, maxRetries:3 });
      const confirmation = await appState.waitForSignatureConfirmation(rpc, { signature:submittedSignature, lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
      if (confirmation.value.err) throw new Error(`Funding transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      const [sourceAfter, destinationAfter] = await Promise.all([
        rpc.getTokenAccountBalance(source, 'finalized').then(row => BigInt(row.value.amount)),
        rpc.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)),
      ]);
      if (sourceBefore - sourceAfter !== amount || destinationAfter - destinationBefore !== amount) throw new Error('Funding finalized, but exact token balance changes were not observed.');
      const recorded = await appState.apiRequest('/api/airdrops/reserves/receipt', { method:'POST', body:{ mint:mintAddress, signature:submittedSignature } });
      if (!recorded.available || !recorded.data?.verified) throw new Error('The server did not verify the finalized creator funding receipt.');
      await appState.loadCommunityReserveStatuses();
      appState.renderAirdropProgramDetail(appState.getAirdropPrograms().find(row => row.id === mintAddress));
      appState.showToast('Community reserve funded and verified on Solana');
    } catch (error) {
      appState.communityFundingPreview = null;
      status.append(document.createTextNode(submittedSignature
        ? ` Funding status is uncertain for ${submittedSignature}. Check the Solana transaction before retrying: ${String(error.message || error)}`
        : ` Funding stopped: ${String(error.message || error)}`));
    } finally { button.disabled = false; }
  }
  // app-source-end

  return { checkCommunityClaim, formatCommunityProofAmount, submitCommunityClaim, appendPendingCommunityClaim, fundCommunityReserve };
}
