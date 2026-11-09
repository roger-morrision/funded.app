// Mainnet preparation never loads transaction keys or enables financial workers.
// Keep this separate from public identity validation: placeholders are allowed
// during planning, but credentials and activation flags are not.
export function transactionSignerSetting(name) {
  return /SECRET_KEY|PRIVATE_KEY|KEYPAIR|SIGNER_(?:FILE|KEY|PATH)|SIGNING_KEY|PRICE_SIGNER_KEY/i.test(name);
}

export function mainnetStagingProblems(env) {
  const problems=[];
  for(const [name,raw] of Object.entries(env)) {
    const value=String(raw??'').trim(),key=name.toUpperCase();
    if(!value)continue;
    if(transactionSignerSetting(name))problems.push(`Transaction signer setting is forbidden: ${name}`);
    if(['NODE_OPTIONS','NODE_PATH'].includes(key))problems.push(`Runtime hook is forbidden: ${name}`);
    if((/(?:ENABLED|AUTOCONNECT)$/.test(key)||['VITE_ALLOW_MAINNET','VITE_DEV_MODE','DEV_MODE','DEVNET_TEST_MODE','RPC_ALLOW_AIRDROP'].includes(key))
      && !['false','0','no','off'].includes(value.toLowerCase()))problems.push(`Activation setting must be disabled: ${name}`);
  }
  return problems;
}

export function assertMainnetStagingPolicy(env) {
  const problems=mainnetStagingProblems(env);
  if(problems.length)throw Error(`Read-only staging: ${problems.join('; ')}`);
}
