import { PublicKey } from '@solana/web3.js';
import { SOL_ASSET_MINT } from '../reward-merkle.js';
import { rewardBitmap, rewardDiscriminator as discriminator } from './reward-rent.mjs';
export function parseCycleFields(account) {
  const data = Buffer.from(account?.data || []);
  const bitmap=rewardBitmap(account);
  if (!bitmap && (![173,174].includes(data.length)||!data.subarray(0,8).equals(discriminator('account','RewardCycle'))))return null;
  return {
    vault: new PublicKey(data.subarray(8, 40)).toBase58(),
    cycleId: data.subarray(40, 72).toString('hex'),
    root: data.subarray(72, 104).toString('hex'),
    asset: new PublicKey(data.subarray(104, 136)).toBase58() === SOL_ASSET_MINT ? 'SOL' : new PublicKey(data.subarray(104, 136)).toBase58(),
    totalAmount: String(data.readBigUInt64LE(136)),
    distributedAmount: String(data.readBigUInt64LE(144)),
    cutoffAt: Number(data.readBigInt64LE(152)), payoutAt: Number(data.readBigInt64LE(160)), leafCount: data.readUInt32LE(168),
    reserved:data.length >= 174 && data[173] === 1, receiptMode:bitmap?'bitmap':'legacy', bitmap,
  };
}
export function parseCycle(account) {
  const cycle = parseCycleFields(account);
  return cycle?.reserved ? cycle : null;
}
export function parseLegacyCycle(account) {
  const cycle = parseCycleFields(account);
  return cycle && !cycle.reserved && Buffer.from(account.data).length === 173 ? cycle : null;
}

export function parseReserve(account) {
  const data = Buffer.from(account?.data || []);
  if (data.length !== 81 || !data.subarray(0, 8).equals(discriminator('account', 'RewardReserve'))) return null;
  return { vault:new PublicKey(data.subarray(8, 40)).toBase58(), asset:new PublicKey(data.subarray(40, 72)).toBase58(),
    outstanding:String(data.readBigUInt64LE(72)), bump:data[80] };
}

export function parsePayment(account) {
  const data = Buffer.from(account?.data || []);
  if (data.length < 92 || !data.subarray(0, 8).equals(discriminator('account', 'RewardPayment'))) return null;
  return { cycle: new PublicKey(data.subarray(8, 40)).toBase58(), recipient: new PublicKey(data.subarray(40, 72)).toBase58(), amount: String(data.readBigUInt64LE(72)), leafIndex: data.readUInt32LE(80), paidAt: Number(data.readBigInt64LE(84)), receivedAmount: data.length >= 100 ? String(data.readBigUInt64LE(92)) : null };
}
