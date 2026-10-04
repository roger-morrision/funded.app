/** Read-only independent recheck of October 1 receipts, not a fresh end-to-end run. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deriveMintFeeRouter } from '../fee-router.js';
import { DEVNET_GENESIS } from './devnet-acceptance.mjs';

const rpcUrl = 'https://api.devnet.solana.com';
const mint = 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
const router = deriveMintFeeRouter('2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik', mint).address.toBase58();
const vault = 'HZwtGTtJ6xmrvfeMwWccbUwMwvdd7Nk5fK27i9DdfMbE';
const cases = [
  { name: 'fresh-token-launch', signature: '5Rs9wsB3Pp1rrKMc6RNohmjUDWBypwi5vnTGicgEoV3bcTkSSPSLteVBbQ2UCoAfcZ49QoxU2H8a3tJJihfg2UQq', launchMint: mint },
  { name: 'post-graduation-buy', signature: '4LQ39ihzxUmTmnma2n7gZo3RB8WuEMwWcQw82HLc8Kszn3ZdQRvuE8z9kgGGhuEQEtydL8ngdEH5U4kMFmHgApod', tokenMint: '5D6NrzqP94RdCjnyJan44AGxJF1fANjkVWDa6G4HtTBC', tokenTransfer: '471552674318', tradeSide: 'buy' },
  { name: 'post-graduation-sell', signature: '36W7uhUhiaQQHRevvZ43urqrMhSiEVz7QmqtbQeRF11q37s2r5NCeCXPzBmrm3yFWDMwb31Jrq19wp3dYpwTWHMW', tokenMint: '5D6NrzqP94RdCjnyJan44AGxJF1fANjkVWDa6G4HtTBC', tokenTransfer: '471552674318', tradeSide: 'sell' },
  { name: 'boost-launch-burn', signature: '2t8pEcEbbjuczDSGHpHFvjwLFkfFRwfNNVGaJ1yaauGk4ndYtkmbeqwtAKEQwZXxt1HgTfduUggJEKavDew4mgse', launchMint: 'BHrufSkFKWqYsReUcVGGvxki1fh2VZryHCzd42KkuYeA', burn: '25000000000' },
  { name: 'pro-launch-burn', signature: '35ryPnWdCTtbEYnFHHmLqwKSxeKU6yV7qhH1sFnsWtkHoV71Un6VHP8R2yz8PmjhZPTyBMWnj6EbERQreggkegLi', launchMint: '8n2DHBtMGGp2GWQzRdjY9bDra9wndcHKiDJvmiHUogy6', burn: '100000000000' },
  { name: 'premier-launch-burn', signature: 'Kof418ZwxMmtD3XVFrFXZsZdhd7j2rfakmUK55GCZpPFtnwq2fsUkKukf4vaAznaNUJxGYpV4gsMeg2XhzLwLvY', launchMint: '35jU9iX21TkjeaMvxh726x1MeAucHz2CdKwDn1nfxW9v', burn: '250000000000' },
  { name: 'paid-listing-burn', signature: 'J3oU5M6QPQGoKoeEGAi8PUvGEiu5uyxb8vMuKpaXZGn7NPzFwWa6zDBCw7x9Fuvn3hxubQC6eqHE9Nn8SZgYQbA', burn: '25000000000' },
  { name: 'creator-fee-collection', signature: '2WE8nJ3iTm8DixxUsxF9tr4kYqG7xZRoZi6pVYikFPw8ZKaMzMiTd3NnHQBTRnBiSAqDp5vp9sgHbrWdpeHen8zF', lamports: [[router, 8500537]] },
  { name: 'holder-vault-funding', signature: 'Tsto6M3spBfDDzAcP3RG6BSRVA2wXxkUf3KM1wU3boZyf8s3iGBh7SxkaeSzR4uaJiwy1GrN41GxjvREk5ooZD6', lamports: [[vault, 850054], [router, -850054]] },
  { name: 'holder-payout-1', signature: '61DBrPuDVUxXJwVohmc5uhAsyNyshXdDtGAntLHRzR5cArSGHxPWSVWFck7F6LVoZvbSH6vDzgFr9eKfHtFamTz6', lamports: [['7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk', 23437], [vault, -23437]] },
  { name: 'holder-payout-2', signature: '4M9f74n28PHEU35KFn9s3coTxmd3arQBtSXogbBCXdphLXtdUgV4RQj7VYz1cm9ZwoYEjwDumbDrtfKbqeJ5JNrp', lamports: [['8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk', 795348], [vault, -795348]] },
  { name: 'holder-payout-3', signature: 'J23DEv9D4GDtdDfjLEq8Vd5A8GjQmjmpeR3zD86iUPNGj4HSrw45fw2cnPxrV2VL6W1eXEg84hxayJbmwCUSGJR', lamports: [['CRRaMRKxThkTUUMj9DrshBxDWbcVRdTgWj9ubbMnXTm7', 31267], [vault, -31267]] },
  { name: 'community-reserve-funding', signature: '3nauE1HuT3Df1zaEBaPwpShadLfdazEswwq5ye6UHtraDPnyEe6Y2Q4ntetmKuqqK23qvhzqzm21bMre6osr9iMm', tokenTransfer: '30000000000000' },
  { name: 'community-drop-opening', signature: '46yo1umgDnzkw7KTrADRVgANMEqvVSsPbUeTDrKkGPSKMXNBvxSvRSo48Q1rnveBESEuPjPPNuq9eiv8gHmAxSBW', tokenTransfer: '30000000000000' },
  { name: 'community-wallet-claim', signature: '5Z4W5iyRwpThaobwVePxcEaRVSVru6XCV2EEDrRiDbBzPswRHsLe6srbCJnVKWiEEUeuuyE2x9szCZ4eQi9kKbm1', tokenTransfer: '42353538' },
  { name: 'buyback-and-burn', signature: '2QMWeJmahR8DVCbvbFwZe3NWDrFB8An4we73etaaM8JQKXbnR59TbJPgwMdWgUWYzh4TnXYmv2p4gSjbTAMUkL1y', burn: '2232461' },
  { name: 'buyback-refund', signature: '5RWFZMxZYDZX1HyDNxXYpzvhDTrp36V86ioj9h7giZnbiNFB2sqRnAwhLVN6P6vRiAaWi1kR8rVAkSobKoYfdjrb', lamports: [[router, 834]] },
];
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), network: 'devnet', evidenceType: 'historical-receipt-reverification', freshTransactionsSubmitted: 0, applicationStateVerified: false, fullApplicationJourney: false, receipts: [] };
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25_000) });
  const payload = await response.json();
  assert(response.ok && !payload.error, `RPC ${method}: HTTP ${response.status}, ${payload.error?.message || 'request failed'}`);
  return payload.result;
}
assert.equal(await rpc('getGenesisHash'), DEVNET_GENESIS);
for (const test of cases) {
  const row = { name: test.name, signature: test.signature, explorer: `https://explorer.solana.com/tx/${test.signature}?cluster=devnet` };
  try {
    const receipt = await rpc('getTransaction', [test.signature, { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
    assert(receipt, 'RPC has no historical receipt for this signature.');
    assert.equal(receipt.meta?.err, null, 'Transaction failed.');
    assert.equal(receipt.transaction.signatures[0], test.signature);
    row.slot = receipt.slot;
    row.blockTime = receipt.blockTime;
    row.finalized = true;
    const keys = receipt.transaction.message.accountKeys.map(key => key.pubkey);
    if (test.launchMint) {
      assert(keys.includes(test.launchMint), 'Expected launched mint is absent.');
      assert((receipt.meta.logMessages || []).some(log => log.includes('Instruction: CreateV2')), 'Missing Pump CreateV2 execution log.');
      assert(receipt.transaction.message.instructions.some(instruction => instruction.programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), 'Missing Pump instruction.');
      assert((receipt.meta.postTokenBalances || []).some(balance => balance.mint === test.launchMint && BigInt(balance.uiTokenAmount.amount) > 0n), 'Launched mint has no positive token balance.');
      row.launchMint = test.launchMint;
    }
    row.lamportChecks = (test.lamports || []).map(([address, expected]) => {
      const index = keys.indexOf(address);
      assert(index >= 0, `Expected account ${address} missing.`);
      const delta = receipt.meta.postBalances[index] - receipt.meta.preBalances[index];
      assert.equal(delta, expected, `Unexpected SOL delta for ${address}`);
      return { address, expected, actual: delta };
    });
    const before = new Map((receipt.meta.preTokenBalances || []).map(balance => [balance.accountIndex, balance]));
    const after = new Map((receipt.meta.postTokenBalances || []).map(balance => [balance.accountIndex, balance]));
    row.tokenDeltas = [...new Set([...before.keys(), ...after.keys()])].map(index => ({ account: keys[index], mint: (after.get(index) || before.get(index)).mint, owner: (after.get(index) || before.get(index)).owner, deltaBaseUnits: (BigInt(after.get(index)?.uiTokenAmount.amount || '0') - BigInt(before.get(index)?.uiTokenAmount.amount || '0')).toString() }));
    if (test.tokenTransfer) {
      const changes = row.tokenDeltas.filter(change => change.mint === (test.tokenMint || mint));
      assert(changes.some(change => change.deltaBaseUnits === test.tokenTransfer), 'Missing exact recipient token credit.');
      assert(changes.some(change => change.deltaBaseUnits === `-${test.tokenTransfer}`), 'Missing exact source token debit.');
      if (test.tradeSide) {
        const signers = receipt.transaction.message.accountKeys.filter(key => key.signer).map(key => key.pubkey);
        const userChanges = changes.filter(change => signers.includes(change.owner));
        const expectedDelta = test.tradeSide === 'buy' ? BigInt(test.tokenTransfer) : -BigInt(test.tokenTransfer);
        assert.equal(userChanges.reduce((sum, change) => sum + BigInt(change.deltaBaseUnits), 0n), expectedDelta, 'Trader token delta has incorrect amount/direction.');
        row.tradeSide = test.tradeSide;
      }
      assert.equal(changes.reduce((sum, change) => sum + BigInt(change.deltaBaseUnits), 0n), 0n, 'Token transfer is not conserved.');
    }
    if (test.burn) {
      const instructions = [...receipt.transaction.message.instructions, ...(receipt.meta.innerInstructions || []).flatMap(inner => inner.instructions)];
      const burn = instructions.find(instruction => instruction.parsed?.type === 'burnChecked');
      assert(burn, 'No parsed BurnChecked instruction.');
      const amount = burn.parsed.info.tokenAmount?.amount ?? burn.parsed.info.amount;
      assert.equal(burn.parsed.info.mint, 'C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64', 'Unexpected FUNDED burn mint.');
      assert.equal(amount, test.burn, 'Burn amount mismatch.');
      row.burn = { mint: burn.parsed.info.mint, baseUnits: amount, program: burn.programId };
      const supplyDelta = row.tokenDeltas.filter(change => change.mint === row.burn.mint).reduce((sum, change) => sum + BigInt(change.deltaBaseUnits), 0n);
      assert.equal(supplyDelta, -BigInt(test.burn), 'Aggregate token-account debit does not match burn.');
    }
    row.status = 'passed';
  } catch (error) {
    row.status = 'blocked';
    row.reason = String(error.message).slice(0, 600);
  }
  report.receipts.push(row);
  console.log(JSON.stringify({ name: row.name, status: row.status, reason: row.reason, slot: row.slot }));
  await new Promise(resolveDelay => setTimeout(resolveDelay, 1500));
}
report.passed = report.receipts.filter(row => row.status === 'passed').length;
report.blocked = report.receipts.length - report.passed;
await mkdir('docs/audit/devnet-2026-10-04', { recursive: true });
await writeFile('docs/audit/devnet-2026-10-04/historical-receipts.json', `${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.blocked ? 2 : 0;
