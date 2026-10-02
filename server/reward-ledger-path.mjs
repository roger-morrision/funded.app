import { resolve } from 'node:path';

export function rewardLedgerPath(env = process.env, cwd = process.cwd()) {
  if (env.AUTOMATIC_REWARD_STORE_PATH) return resolve(cwd, env.AUTOMATIC_REWARD_STORE_PATH);
  if (env.FUNDED_STORE_PATH) return `${resolve(cwd, env.FUNDED_STORE_PATH)}.automatic-rewards.json`;
  return resolve(cwd, 'data', 'automatic-rewards.json');
}
