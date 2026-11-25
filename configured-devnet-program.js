// Public admission identity for the live configurable Devnet release.
// Historical offline fixtures keep their separate, immutable context.
export const CONFIGURED_DEVNET_PROGRAM = Object.freeze({
  cluster:'devnet', programId:'9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf',
  programDataSha256:"db5f23382be5655a841c43423c1e96ad6696061d2cfdad266815756314399b89",
  upgradeAuthority:'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
  bytes:1206632, sha256:"bf3d7c28708a9398aaaea5852df1cf76166835cade85b415856d411c031e464f",
  assetConfiguration:'onchain-v1',
});
export function configuredDevnetProgram(cluster,programId){
  return cluster==='devnet'&&String(programId)===CONFIGURED_DEVNET_PROGRAM.programId?CONFIGURED_DEVNET_PROGRAM:null;
}
