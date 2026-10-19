import {PublicKey} from '@solana/web3.js';
import {deriveAgencyConfigV3,decodeAgencyConfigV3,agencyProtocolSplit} from '../agency-mint-router-v3.js';
import {DEVNET_GENESIS_HASH,readProgramDataEvidence} from './automatic-reward-chain.mjs';
import {verifyFeeRouterAccount} from '../fee-router.js';
import {agencyReleaseVerified} from './agency-release.mjs';

export async function readAgencyDeployment({connection,programId,approvedHash,authority,
  readProgram=readProgramDataEvidence,verifyRouter=verifyFeeRouterAccount,verifyRelease=agencyReleaseVerified}){
  const [genesis,evidence,router,account]=await Promise.all([connection.getGenesisHash(),readProgram(connection,programId),
    verifyRouter({connection,programId,commitment:'finalized'}),connection.getAccountInfo(deriveAgencyConfigV3(programId).address,'finalized')]);
  if(genesis!==DEVNET_GENESIS_HASH||!verifyRelease(evidence,programId,approvedHash)||!router.verified
    ||!router.authority.equals(new PublicKey(authority)))throw new Error('Reviewed agency binary and current Devnet authority are not verified.');
  const config=decodeAgencyConfigV3(account,programId);
  return{verified:true,programId:String(programId),approvedHash,authority:new PublicKey(authority).toBase58(),
    ...config,protocolSplit:agencyProtocolSplit(config.protocolUnits)};
}
export function agencyWorkerHealth(state,{programId,approvedHash,authority,revision,build,now=Date.now()}){
  const row=state.adminSettings?.agencyWorker;
  return Boolean(row?.status==='ready'&&row.version==='agency-executor-v1'&&row.cluster==='devnet'
    &&row.programId===String(programId)&&row.approvedHash===approvedHash&&row.authority===String(authority)
    &&row.configRevision===String(revision)&&typeof build==='string'&&build.length>0&&row.build===build
    &&/^\d{1,30}$/.test(String(row.xAccountId))&&row.capabilities?.join(',')==='x-promotion,buyback-100k,buyback-300k'
    &&Number.isSafeInteger(Date.parse(row.checkedAt))&&now-Date.parse(row.checkedAt)>=0&&now-Date.parse(row.checkedAt)<90000);
}
