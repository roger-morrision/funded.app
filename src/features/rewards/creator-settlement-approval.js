export function mountCreatorSettlementApprovalTool(appState, connected) {
  const anchor = document.querySelector('#profile-status');
  if (!anchor) return;
  let section = document.querySelector('#creator-settlement-approval');
  if (section) { section.hidden = !connected; return; }
  section = document.createElement('section');
  section.id = 'creator-settlement-approval';
  section.className = 'profile-creator-approval';
  const heading = document.createElement('h3'); heading.textContent = 'Approve a creator fee payout';
  const note = document.createElement('p'); note.textContent = 'Ask the claimant for their claim ID. Review the destination and amount before signing.';
  const input = document.createElement('input'); input.type = 'text'; input.maxLength = 160; input.placeholder = 'Claim ID'; input.setAttribute('aria-label', 'Claim ID to approve');
  const review = document.createElement('button'); review.type = 'button'; review.className = 'secondary-button'; review.textContent = 'Review payout';
  const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'primary-button'; approve.textContent = 'Sign payout'; approve.hidden = true;
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let prepared = null;
  review.onclick = async () => {
    prepared = null; approve.hidden = true; review.disabled = true;
    try {
      const session = appState.captureWalletSession();
      if (!session || session.provider.readOnly || typeof session.provider.signTransaction !== 'function') throw new Error('Connect a wallet that can sign transactions.');
      const claimId = input.value.trim();
      if (!claimId) throw new Error('Enter the claim ID shared by the claimant.');
      const response = await appState.apiRequest(`/api/sol-claims/${encodeURIComponent(claimId)}/execute`, { method:'POST' });
      appState.assertWalletSessionCurrent(session);
      if (response.data?.status !== 'awaiting-creator-signature') {
        if (response.data?.signature) { status.textContent = `This payout is already finalized: ${response.data.signature}`; return; }
        throw new Error('This claim is not ready for creator approval.');
      }
      if (response.data.creatorWallet !== session.address) throw new Error('Connect the launch creator wallet for this claim.');
      const amount = BigInt(response.data.amountLamports);
      const sol = `${amount / 1_000_000_000n}.${String(amount % 1_000_000_000n).padStart(9, '0')}`;
      status.textContent = `Review ${sol} SOL to ${response.data.recipient}. The wallet will show the transaction before you approve it.`;
      prepared = { ...response.data, claimId, session };
      approve.hidden = false;
    } catch (error) { status.textContent = error.message || 'Payout review unavailable.'; }
    finally { review.disabled = false; }
  };
  approve.onclick = async () => {
    if (!prepared) return;
    approve.disabled = true;
    try {
      appState.assertWalletSessionCurrent(prepared.session);
      const { Transaction } = await appState.getSolana();
      const transaction = Transaction.from(appState.base64ToBytes(prepared.transaction));
      const signed = await prepared.session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(prepared.session);
      status.textContent = 'Checking the signed payout and waiting for finalized Devnet proof…';
      const result = await appState.apiRequest(`/api/sol-claims/${encodeURIComponent(prepared.claimId)}/execute`, {
        method:'POST', body:{ creatorSignedTransaction:appState.bytesToBase64(signed.serialize({ requireAllSignatures:false, verifySignatures:false })) },
      });
      appState.assertWalletSessionCurrent(prepared.session);
      if (!result.data?.signature) throw new Error('Payout outcome is uncertain. Recheck the claim before signing again.');
      status.textContent = `Payout finalized: ${result.data.signature}`;
      prepared = null; approve.hidden = true;
    } catch (error) { status.textContent = error.message || 'Payout approval failed.'; }
    finally { approve.disabled = false; }
  };
  section.append(heading, note, input, review, approve, status);
  anchor.after(section);
  section.hidden = !connected;
}
