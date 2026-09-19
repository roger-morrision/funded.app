import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildLaunchTransaction, devnetExplorer, normalizeLaunchInput } from '../launch-core.js';
import { connectWalletProvider } from '../wallet-core.js';

const payer = Keypair.generate().publicKey;
const connection = { getMinimumBalanceForRentExemption: async () => 1_461_600 };
const input = normalizeLaunchInput({ name: 'Verification Coin', symbol: 'VERIFY', supply: 1_000_000, decimals: 6 });
const plan = await buildLaunchTransaction({ connection, payer, supply: input.supply, decimals: input.decimals });

assert.equal(plan.amount, 1_000_000_000_000n);
assert.equal(plan.transaction.instructions.length, 4);
assert.equal(plan.transaction.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
assert.equal(plan.transaction.instructions[1].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
assert.equal(plan.transaction.instructions[2].programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
assert.equal(plan.transaction.instructions[3].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
assert.ok(plan.mint.publicKey instanceof PublicKey);
assert.ok(plan.ata instanceof PublicKey);
assert.match(devnetExplorer(`tx/${'a'.repeat(88)}`), /cluster=devnet$/);

const provider = { publicKey: payer, signTransaction: async tx => tx, connect: async () => ({ publicKey: payer }) };
const connected = await connectWalletProvider(provider);
assert.equal(connected.provider, provider);
assert.equal(connected.publicKey, payer);
console.log('launch verification passed');
