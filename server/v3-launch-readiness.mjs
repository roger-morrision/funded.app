import { PublicKey } from '@solana/web3.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { deriveMintRouterV3, directedGrossUnits, verifyMintPolicyV3Account,
  verifyMintRouterV3Account } from '../mint-router-v3.js';
import { readProgramDataEvidence } from './automatic-reward-chain.mjs';
import { requireSolanaCluster, SOLANA_GENESIS } from '../solana-network.js';

// Registration must check the program actually running on the selected chain, as well as
// the immutable per-mint accounts. A launch record or matching PDA alone does
// not establish that the deployed program enforces the configured 80/20 split.
export async function verifyV3LaunchRouterReadiness({ connection, programId, expectedProgramDataSha256, cluster = 'devnet',
  mint, creatorWallet, initialAuthority, split = PROTOCOL_FEE_SPLIT,
  directedShares = null, requireProtectedPolicy = false,
  agencySelection = null,
  readEvidence = readProgramDataEvidence, verifyGlobal = verifyFeeRouterAccount,
  verifyRouter = verifyMintRouterV3Account, verifyPolicy = verifyMintPolicyV3Account }) {
  if (!programId || !/^[a-f0-9]{64}$/i.test(String(expectedProgramDataSha256 || ''))) {
    return { ready:false, status:503, error:'The approved V3 program is not configured.' };
  }
  try {
    requireSolanaCluster(cluster);
    const program = new PublicKey(programId).toBase58();
    const mintKey = new PublicKey(mint).toBase58();
    const creator = new PublicKey(creatorWallet).toBase58();
    const authority = new PublicKey(initialAuthority).toBase58();
    const genesis = await connection.getGenesisHash();
    if (genesis !== SOLANA_GENESIS[cluster]) {
      return { ready:false, status:503, error:'The RPC does not match the selected network.' };
    }
    const [evidence, global] = await Promise.all([
      readEvidence(connection, program, cluster === 'devnet' ? {} : {rpcUrl:''}),
      verifyGlobal({ connection, programId:program, commitment:'finalized' }),
    ]);
    if (genesis !== SOLANA_GENESIS[cluster] || !evidence.account?.executable
      || evidence.sha256 !== expectedProgramDataSha256.toLowerCase() || !global.verified) {
      return { ready:false, status:503, error:'The approved V3 program or global router could not be verified on the selected network.' };
    }
    const [router, policy] = await Promise.all([
      verifyRouter({ connection, programId:program, mint:mintKey, initialAuthority:authority }),
      verifyPolicy({ connection, programId:program, mint:mintKey, creator,
        initialAuthority:authority, split }),
    ]);
    const configuredRouter = deriveMintRouterV3(program, mintKey).address.toBase58();
    const expectedDirected = directedShares ? directedGrossUnits(directedShares) : null;
    if (!router.verified || router.address.toBase58() !== configuredRouter || !policy.verified
      || requireProtectedPolicy && (!policy.protectedPolicy || !expectedDirected
        || policy.directedUnits.some((value, index) => value !== expectedDirected[index]))
      || agencySelection&&(!policy.agencyPolicy||String(policy.configRevision)!==String(agencySelection.configRevision))) {
      return { ready:false, status:409, error:'The V3 mint router or immutable fee policy is not verified.' };
    }
    if(agencySelection){
      const{agencySelectionMask}=await import('../agency-mint-router-v3.js');
      if(policy.selectedMask!==agencySelectionMask(agencySelection.selectedAgents))return{ready:false,status:409,error:'The immutable agency selection differs from the signed launch.'};
    }
    return { ready:true, cluster, genesisHash:genesis, configuredRouter, programId:program,
      protectedPolicy:Boolean(policy.protectedPolicy), directedUnits:policy.directedUnits || null };
  } catch {
    return { ready:false, status:503, error:'The V3 router accounts could not be verified.' };
  }
}
