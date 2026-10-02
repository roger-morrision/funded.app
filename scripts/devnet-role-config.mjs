import { readFileSync } from 'node:fs';

function value(env, name) {
  return String(env?.[name] || '').trim();
}

export function configuredSecret(env, primary, fallbacks = [], readFile = readFileSync) {
  const direct = value(env, primary);
  if (direct) return direct;
  const path = value(env, `${primary}_FILE`);
  if (path) return String(readFile(path, 'utf8')).trim();
  for (const fallback of fallbacks) {
    const candidate = value(env, fallback);
    if (candidate) return candidate;
  }
  return '';
}

export function resolveDevnetBuybackConfig(env, readFile = readFileSync) {
  const cluster = value(env, 'SOLANA_CLUSTER');
  const operatorSecret = configuredSecret(env, 'FUNDED_BUYBACK_OPERATOR_SECRET_KEY', ['QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY'], readFile);
  const authoritySecret = configuredSecret(env, 'FUNDED_ROUTER_AUTHORITY_SECRET_KEY', ['QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY'], readFile);
  const qaMode = value(env, 'DEVNET_TEST_MODE') === 'true' && Boolean(value(env, 'QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY'));
  return {
    cluster,
    operatorSecret,
    authoritySecret,
    enabled: cluster === 'devnet' && (value(env, 'FUNDED_BUYBACK_EXECUTOR_ENABLED') === 'true' || qaMode),
    source: value(env, 'FUNDED_BUYBACK_OPERATOR_SECRET_KEY') || value(env, 'FUNDED_BUYBACK_OPERATOR_SECRET_KEY_FILE')
      ? 'dedicated' : operatorSecret ? 'qa-role' : 'missing',
  };
}
