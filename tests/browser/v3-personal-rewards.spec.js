import { expect, test } from '@playwright/test';

test('connected creator sees V3 payout history and no retired claim action', async ({ page }) => {
  const mint='FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
  const wallet='7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
  const programId='9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm';
  const source='3'.repeat(64);
  await page.route('**/api/**', route => route.fulfill({ status:503, json:{error:'offline fixture'} }));
  await page.route('**/api/launches', route => route.fulfill({ json:[{
    mint,name:'V3 QA coin',symbol:'V3QA',cluster:'devnet',onchainVerified:true,
    creatorWallet:wallet,creator:'v3-router',
    pumpFeeRoute:{scope:'per-mint-v3',router:'v3-router',programId},
  },{
    mint:'V2old',name:'Retired V2 coin',cluster:'devnet',onchainVerified:true,
    creatorWallet:wallet,creator:'v2-router',pumpFeeRoute:{scope:'per-mint-v2',router:'v2-router'},
  }] }));
  await page.route(`**/api/tokens/${mint}/fee-activity`, route => route.fulfill({ json:{
    mint,cluster:'devnet',overview:{available:true,scope:'per-mint-v3',creatorWallet:wallet,
      gates:{creatorWalletPayout:true},collections:[{signature:source,settlement:'finalized',
        creatorWalletPayout:'pending',allocationPlan:{status:'allocated-not-funded',mint,
          programId,sourceCollectionSignature:source,creatorDirected:{walletLamports:'123000000'}}}]},
  } }));
  await page.goto('/#payments');
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.evaluate(address => {
    document.documentElement.dataset.connectedWallet=address;
    window.dispatchEvent(new Event('funded:reward-identity-change'));
  },wallet);
  await page.getByRole('tab',{name:'Creator'}).click();
  const rewards=page.locator('[data-creator-rewards]');
  await expect(rewards).toContainText('0.123 SOL');
  await expect(rewards).toContainText('V3 QA coin');
  await expect(rewards).not.toContainText('Retired V2 coin');
  await expect(rewards.getByRole('link',{name:'Review V3 payouts for V3QA'}))
    .toHaveAttribute('href',`/token/${mint}`);
  await expect(rewards.getByRole('button',{name:/Approve payouts|Claim SOL/})).toHaveCount(0);
});
