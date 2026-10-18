import { expect, test } from '@playwright/test';

test('V3 mint router instruction can be built in the browser', async ({ page }) => {
  await page.goto('/');
  const built = await page.evaluate(async () => {
    const { buildLaunchMintRouter } = await import('/launch-flow.js');
    const router = buildLaunchMintRouter({
      feeRouterProgramId:'61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa',
      mint:'So11111111111111111111111111111111111111112',
      payer:'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
      v3FeeRouter:{
        programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',
        initialAuthority:'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
        split:{ operationsPercent:50, referralLevelPercents:[10,3,2],
          communityPercent:10, buybackPercent:25 },
      },
      feeShares:{ creatorWalletPercent:80, holderAirdropPercent:0, solClaimPercent:0 },
    });
    return { scope:router.scope, program:router.instruction.programId.toBase58(),
      authoritySigner:router.instruction.keys[0].isSigner,
      creatorSigner:router.instruction.keys[1].isSigner,
      mintSigner:router.instruction.keys[2].isSigner,
      units:router.protocolUnits };
  });
  expect(built).toEqual({
    scope:'per-mint-v3', program:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',
    authoritySigner:false, creatorSigner:true, mintSigner:true,
    units:[1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000],
  });
});
