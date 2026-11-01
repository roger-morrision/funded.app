// Execution can differ for historical coins; configuration is not payment proof.
export const FEE_EXECUTION_COPY=Object.freeze({
 collection:'The keeper collects eligible Pump creator fees into the coin’s V3 router. On an active automatic route, saved-policy settlement, funding and supported payouts run without a creator signature. Manual routes can require creator approval. Verify funding and recipient payments separately.',
 creator:'The creator wallet receives its saved share automatically when the automatic route is active and funded. Manual payout routes require the creator’s signature. A payment is complete only after its transaction and balance change are verified.',
 referralDelivery:'Referral recipients do not claim or sign. Active automatic routes pay the recorded upline after verified settlement and funding; manual routes can require creator approval. Check finalized receipts.',
});
