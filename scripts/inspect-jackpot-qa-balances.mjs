import { readFileSync } from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError } from '@solana/spl-token';

const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL ||
  'https://api.devnet.solana.com', 'finalized');
if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
  throw new Error('This endpoint is not Solana Devnet.');
const mint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const mintState = await getMint(connection, mint, 'finalized', TOKEN_PROGRAM_ID);
const groups = [
  ['.secrets/devnet-qa-wallets-20260930/public.json', ['creator', 'referrer', 'claimant']],
  ['.secrets/devnet-app-roles-20260930/public.json', [
    'app_owner', 'pump_fee_keeper', 'pump_revenue_treasury',
    'trading_fee_treasury', 'router_authority', 'funded_holder',
    'coin_holder', 'x_partner', 'buyback_operator', 'referral_payout_funder',
  ]],
];
const rows = [];
for (const [path, roles] of groups) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const role of roles) {
    const address = new PublicKey(manifest.find(item => item.role === role && item.cluster === 'devnet')?.address);
    const ata = getAssociatedTokenAddressSync(mint, address);
    const [account, sol] = await Promise.all([
      getAccount(connection, ata, 'finalized', TOKEN_PROGRAM_ID).catch(error => {
        if (error instanceof TokenAccountNotFoundError) return null;
        throw error;
      }),
      connection.getBalance(address, 'finalized'),
    ]);
    rows.push({ role, wallet:address.toBase58(), ata:ata.toBase58(),
      fundedBaseUnits:String(account?.amount ?? 0n), solLamports:sol });
  }
}
console.log(JSON.stringify({ cluster:'devnet', mint:mint.toBase58(),
  decimals:mintState.decimals, supplyBaseUnits:String(mintState.supply),
  mintAuthority:mintState.mintAuthority?.toBase58() ?? null,
  wallets:rows }));
