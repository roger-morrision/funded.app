// Shared product policy for Help, Questions, Docs and reward surfaces.
export const communityAirdropCopy = {
  summary:'Each launch reserves at least 3% of its launched coin supply for an automatic airdrop to eligible wallets holding $FUNDED at that coin’s migration.',
  eligibility:'Hold $FUNDED until the coin migrates. Eligibility and allocation use your balance in the verified migration-time snapshot; buying after migration does not qualify for that coin’s airdrop.',
  allocation:'Your airdrop = the launched-token airdrop pool × your eligible $FUNDED balance ÷ total eligible $FUNDED holdings at migration. Amounts are rounded down to token base units; excluded wallets do not enter the eligible total.',
  delivery:'Launched coin tokens are sent automatically to the same eligible wallet after the migration snapshot, reserve funding and on-chain approval are verified. No recipient claim, wallet signature or transaction fee is required. Migration fixes eligibility; verification and network processing can delay delivery.',
};
export const communityAirdropGuide = () => Object.values(communityAirdropCopy).map(text=>`<p>${text}</p>`).join('');
