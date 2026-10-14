import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from '../distribution-policy.js';
import { protocolGrossUnits } from '../mint-router-v3.js';

export async function activeProtocolFeeSplit(store) {
  const state = await store.read();
  const split = validateProtocolFeeSplit(state.adminSettings?.protocolFeePolicy?.split || PROTOCOL_FEE_SPLIT);
  // The contract stores integer ten-millionths of gross fees.
  protocolGrossUnits(split);
  return split;
}

export function launchProtocolFeeSplit(launch) {
  const split = validateProtocolFeeSplit(launch?.pumpFeeRoute?.protocolSplit);
  protocolGrossUnits(split);
  return split;
}
