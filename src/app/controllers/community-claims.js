// Dependencies and mutable application state are read live through appState.
export function createCommunityClaimsController(appState) {
  // app-source: 333
  async function checkCommunityClaim(mintAddress, { silent = false } = {}){
    const status = document.querySelector('#airdrop-selected-status');
    if (!appState.wallet && !silent) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session) { if (!silent) status.append(document.createTextNode(' Connect a Solana wallet to check this allocation.')); return; }
    const program = appState.getAirdropPrograms().find(row => row.id === mintAddress);
    const saved = appState.readPendingCommunityClaim();
    let recoveredProof = null;
    if (saved) {
      if (saved.wallet !== session.address || saved.mint !== mintAddress) {
        if (!silent) status.append(document.createTextNode(' Another signed community claim in this browser needs verification before a new one.'));
        return;
      }
      if (silent) return;
      try {
        const rpc = await appState.getTradePreviewConnection();
        const receipt = (await rpc.getSignatureStatuses([saved.signature], { searchTransactionHistory:true })).value?.[0];
        if (receipt?.err) {
          appState.clearPendingCommunityClaim(saved);
          status.append(document.createTextNode(' The original claim failed on Solana. Check eligibility again before signing.'));
        } else if (receipt?.confirmationStatus === 'finalized') {
          const response = await appState.apiRequest(`/api/airdrops/claims/proof?mint=${encodeURIComponent(mintAddress)}&wallet=${encodeURIComponent(session.address)}`);
          if (!response.available || response.data?.status !== 'claimed'
            || response.data.recipient && response.data.recipient !== session.address
            || response.data.mint && response.data.mint !== mintAddress) {
            appState.appendPendingCommunityClaim(status, mintAddress, saved.signature, false, true);
            return;
          }
          appState.clearPendingCommunityClaim(saved);
          recoveredProof = response;
        } else {
          appState.appendPendingCommunityClaim(status, mintAddress, saved.signature);
          return;
        }
      } catch {
        appState.appendPendingCommunityClaim(status, mintAddress, saved.signature);
        return;
      }
    }
    if (!program) {
      if (!silent) status.append(document.createTextNode(recoveredProof
        ? ' The original claim is verified, but this token is not in the current directory.'
        : ' This token is not in the current airdrop directory.'));
      return;
    }
    if (!program.claimActive && !recoveredProof) { if (!silent) status.append(document.createTextNode(' Claims are not open for this token.')); return; }
    const pending = appState.communityWalletAllocations.get(mintAddress);
    if (pending && pending.wallet === session.address && pending.snapshotHash === program.snapshotHash
      && (pending.status === 'checking' || silent)) return;
    if (!silent && status?.dataset) {
      status.dataset.communityClaimWallet = session.address;
      status.dataset.communityClaimMint = mintAddress;
    }
    appState.updateDirectoryWalletAmount(session, program, 'checking');
    try {
      const response = recoveredProof || await appState.apiRequest(`/api/airdrops/claims/proof?mint=${encodeURIComponent(mintAddress)}&wallet=${encodeURIComponent(session.address)}`);
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
    let submittedSignature = null, claimExecutionRequested = false, claimVerified = false, claimFailedOnChain = false;
    let saved;
    try { saved = appState.readPendingCommunityClaim(); }
    catch (error) { status.append(document.createTextNode(` Claim stopped: ${String(error.message || error)}`)); return; }
    if (saved) {
      if (saved.wallet === session?.address && saved.mint === mintAddress)
        appState.appendPendingCommunityClaim(status, mintAddress, saved.signature);
      else status.append(document.createTextNode(' Another signed community claim needs verification before a new one.'));
      return;
    }
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
      const reserve = appState.verifiedCommunityReserves.get(mintAddress);
      const launch = appState.verifiedLaunchPolicies.find(row => row.mint === mintAddress);
      const expectedProgramId = launch?.pumpFeeRoute?.scope === 'per-mint-v3'
        ? launch.pumpFeeRoute.programId : null;
      if (!reserve?.verified || !launch?.onchainVerified || launch.cluster !== 'devnet' || !expectedProgramId
        || launch.pumpFeeRoute.verified !== true
        || reserve.programId !== expectedProgramId || claim.programId !== expectedProgramId
        || reserve.scope !== launch.pumpFeeRoute?.scope) {
        throw new Error('Claim program differs from the verified launch and reserve.');
      }
      const program = new PublicKey(expectedProgramId), mint = new PublicKey(mintAddress);
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
      const signedBytes = signed.serialize();
      if (!appState.Buffer.from(signed.serializeMessage()).equals(appState.Buffer.from(transaction.serializeMessage())))
        throw new Error('Wallet changed the reviewed claim transaction. No claim was sent.');
      if (!signed.signature || signed.signature.length !== 64) throw new Error('Wallet returned an unsigned claim transaction. No claim was sent.');
      const pending = appState.savePendingCommunityClaim({ mint:mintAddress, wallet:session.address,
        signature:appState.bs58.encode(signed.signature), cluster:'devnet' });
      submittedSignature = pending.signature;
      claimExecutionRequested = true;
      const returned = await rpc.sendRawTransaction(signedBytes, { skipPreflight:false, maxRetries:3 });
      if (returned !== submittedSignature) throw new Error('RPC returned a different signature. Check the original signed claim.');
      const confirmation = await appState.waitForSignatureConfirmation(rpc, { signature:submittedSignature,
        lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
      if (confirmation.value.err) {
        appState.clearPendingCommunityClaim(pending);
        claimFailedOnChain = true;
        throw new Error(`Claim transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      const after = BigInt((await rpc.getTokenAccountBalance(recipientToken, 'finalized')).value.amount);
      if (after - before !== BigInt(review.amount) || !(await rpc.getAccountInfo(payment, 'finalized'))?.owner.equals(program))
        throw new Error('Claim finalized without the exact token and payment-record deltas.');
      appState.clearPendingCommunityClaim(pending);
      claimVerified = true;
      appState.emitPilotSignal('claim-verified');
      const claimedProgram = appState.getAirdropPrograms().find(row => row.id === mintAddress);
      const claimedAmount = appState.formatTokenBaseUnits(review.amount, mintInfo.data[44], 4);
      if (claimedProgram) appState.updateDirectoryWalletAmount(session, claimedProgram, 'claimed', claimedAmount);
      status.append(document.createTextNode(` Claimed ${claimedAmount} ${claimedProgram?.symbol || 'tokens'} and verified on Solana.`));
      appState.showToast('Community tokens claimed and verified on Solana');
      // The claim is already proven by finalized token and payment deltas.
      // Refreshing every public reserve can be slow and must not delay or
      // replace the recipient's confirmed result in this browser.
      void appState.loadCommunityReserveStatuses().catch(() => {});
    } catch (error) {
      if (!claimVerified) appState.emitPilotSignal(appState.pilotInterruptedSignal('claim', error, claimExecutionRequested));
      if (!appState.isWalletSessionCurrent(session)) return;
      if (claimVerified) { status.append(document.createTextNode(' Claim verified on Solana, but the display could not refresh.')); return; }
      if (submittedSignature) appState.appendPendingCommunityClaim(status, mintAddress, submittedSignature, claimFailedOnChain);
      else status.append(document.createTextNode(` Claim stopped: ${String(error.message || error)}`));
    } finally { if (button) button.disabled = Boolean(submittedSignature); }
  }
  // app-source-end

  // app-source: 335
  function appendPendingCommunityClaim(status, mintAddress, signature, failedOnChain = false, proofPending = false){
    const receipt = document.createElement('a');
    receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${appState.APP_EXPLORER_QUERY}`;
    receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
    receipt.textContent = 'View claim transaction ↗';
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'secondary-button';
    check.dataset.checkCommunityMint = mintAddress; check.textContent = 'Check claim status';
    const message = failedOnChain
      ? 'The claim transaction failed on Solana. No tokens were claimed. Check eligibility again before trying a new transaction. '
      : proofPending ? 'The claim finalized on Solana, but its allocation receipt is not verified yet. Check this claim status again before trying another transaction. '
      : 'Your claim was submitted, but confirmation could not be loaded. Check its status before trying again. ';
    status.append(document.createElement('br'), document.createTextNode(message), receipt, document.createTextNode(' '), check);
  }
  // app-source-end

  // app-source: 336
  async function fundCommunityReserve(mintAddress){
    const session = appState.captureWalletSession();
    const button = document.querySelector('[data-fund-community-mint]');
    const status = document.querySelector('#airdrop-selected-status');
    let submittedSignature = null, fundingFailedOnChain = false;
    if (!session || !appState.canSignTransactions(session.provider)) return;
    if (status?.dataset) {
      status.dataset.communityClaimWallet = session.address;
      status.dataset.communityClaimMint = mintAddress;
    }
    button.disabled = true;
    const recordFinalized = async pending => {
      const recorded = await appState.apiRequest('/api/airdrops/reserves/receipt', { method:'POST',
        body:{ mint:pending.mint, signature:pending.signature } });
      if (!recorded.available || !recorded.data?.verified) throw new Error('The server did not verify the finalized creator funding receipt.');
      appState.clearPendingCommunityFunding(pending);
      if (!appState.isWalletSessionCurrent(session)) return;
      try {
        await appState.loadCommunityReserveStatuses();
        appState.renderAirdropProgramDetail(appState.getAirdropPrograms().find(row => row.id === mintAddress));
      } catch { /* The verified transfer remains complete when the display refresh is unavailable. */ }
      appState.showToast('Community reserve funded and verified on Solana');
    };
    try {
      const saved = appState.readPendingCommunityFunding();
      if (saved) {
        if (saved.wallet !== session.address || saved.mint !== mintAddress)
          throw new Error('Another signed reserve transfer needs verification before a new one.');
        submittedSignature = saved.signature;
        const rpc = await appState.getTradePreviewConnection();
        const receipt = (await rpc.getSignatureStatuses([saved.signature], { searchTransactionHistory:true })).value?.[0];
        if (receipt?.err) {
          appState.clearPendingCommunityFunding(saved);
          fundingFailedOnChain = true;
          throw new Error(`Funding transaction failed: ${JSON.stringify(receipt.err)}`);
        }
        if (receipt?.confirmationStatus !== 'finalized')
          throw new Error('The original transfer has no finalized result yet. Check this signature again later.');
        await recordFinalized(saved);
        return;
      }
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
      const signedBytes = signed.serialize();
      if (!appState.Buffer.from(signed.serializeMessage()).equals(appState.Buffer.from(transaction.serializeMessage())))
        throw new Error('Wallet changed the reviewed reserve transfer. No transfer was sent.');
      if (!signed.signature || signed.signature.length !== 64) throw new Error('Wallet returned an unsigned reserve transfer. No transfer was sent.');
      const pending = appState.savePendingCommunityFunding({ mint:mintAddress, wallet:session.address,
        signature:appState.bs58.encode(signed.signature), cluster:'devnet' });
      submittedSignature = pending.signature;
      const returned = await rpc.sendRawTransaction(signedBytes, { skipPreflight:false, maxRetries:3 });
      if (returned !== submittedSignature) throw new Error('RPC returned a different signature. Verify the original signed transfer.');
      const confirmation = await appState.waitForSignatureConfirmation(rpc, { signature:submittedSignature, lastValidBlockHeight:latest.lastValidBlockHeight, commitment:'finalized' });
      if (confirmation.value.err) {
        appState.clearPendingCommunityFunding(pending);
        fundingFailedOnChain = true;
        throw new Error(`Funding transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      const [sourceAfter, destinationAfter] = await Promise.all([
        rpc.getTokenAccountBalance(source, 'finalized').then(row => BigInt(row.value.amount)),
        rpc.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)),
      ]);
      if (sourceBefore - sourceAfter !== amount || destinationAfter - destinationBefore !== amount) throw new Error('Funding finalized, but exact token balance changes were not observed.');
      await recordFinalized(pending);
    } catch (error) {
      appState.communityFundingPreview = null;
      status.append(document.createTextNode(submittedSignature
        ? fundingFailedOnChain
          ? ` Funding failed on Solana for ${submittedSignature}. No reserve tokens were transferred. Check eligibility before trying again.`
          : ` Funding status needs verification for ${submittedSignature}. Use Check transfer status before signing another transfer: ${String(error.message || error)}`
        : ` Funding stopped: ${String(error.message || error)}`));
      if (submittedSignature) {
        const receipt = document.createElement('a');
        receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(submittedSignature)}${appState.APP_EXPLORER_QUERY}`;
        receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
        receipt.textContent = 'View original transfer ↗';
        status.append(document.createTextNode(' '), receipt);
      }
    } finally {
      button.disabled = false;
      try {
        if (appState.readPendingCommunityFunding()) button.textContent = 'Check transfer status';
        else if (fundingFailedOnChain) button.textContent = 'Review reserve funding';
      } catch { button.disabled = true; }
    }
  }
  // app-source-end

  return { checkCommunityClaim, formatCommunityProofAmount, submitCommunityClaim, appendPendingCommunityClaim, fundCommunityReserve };
}
