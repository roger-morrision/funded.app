// Read-only recipient allocations; only the creator reserve-funding action signs.
export function createCommunityClaimsController(appState){
  async function loadCommunityAllocation(mintAddress){
    const session=appState.captureWalletSession();
    const program=appState.getAirdropPrograms().find(row=>row.id===mintAddress);
    if(!session||!program?.claimPublished)return;
    const cached=appState.communityWalletAllocations.get(mintAddress);
    if(cached?.wallet===session.address&&cached.snapshotHash===program.snapshotHash
      &&(cached.status==='checking'||Date.now()-(cached.checkedAt||0)<30000))return;
    appState.updateDirectoryWalletAmount(session,program,'checking');
    try{
      const response=await appState.apiRequest('/api/airdrops/allocation?mint='+encodeURIComponent(mintAddress)+'&wallet='+encodeURIComponent(session.address),{signal:AbortSignal.timeout(60000)});
      if(!appState.isWalletSessionCurrent(session))return;
      const proof=response.data;
      if(!response.available||!proof?.status||proof.recipient&&proof.recipient!==session.address
        ||proof.mint&&proof.mint!==mintAddress)throw Error('Allocation unavailable');
      const amount=/^\d+$/.test(String(proof.amount))?await formatCommunityProofAmount(mintAddress,proof.amount,session):null;
      appState.updateDirectoryWalletAmount(session,program,proof.status,amount);
    }catch{if(appState.isWalletSessionCurrent(session))appState.updateDirectoryWalletAmount(session,program,'unavailable');}
  }
  async function formatCommunityProofAmount(mintAddress, amount, session){
    const { PublicKey } = await appState.getSolana();
    const mintInfo = await (await appState.getTradePreviewConnection()).getAccountInfo(new PublicKey(mintAddress), 'finalized');
    if (!appState.isWalletSessionCurrent(session)) throw new Error('Wallet changed while checking the claim.');
    if (!mintInfo || mintInfo.data.length < 45) throw new Error('Claim mint is unavailable.');
    return appState.formatTokenBaseUnits(amount, mintInfo.data[44], 4);
  }


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


  return {loadCommunityAllocation,formatCommunityProofAmount,fundCommunityReserve};
}
