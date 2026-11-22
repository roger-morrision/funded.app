// Read-only public RPC sizing. No keys, transactions or spending-cap changes.
import {Connection} from '@solana/web3.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {estimateProgram} from './estimate-program-deploy-cost.mjs';
const candidate=JSON.parse(readFileSync('config/contract-build-candidates.json')).productionBuildCheck;
const bytes=candidate.bytes;
const rpc=new Connection('https://api.mainnet-beta.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true});
const [genesisHash,program,programData,buffer,configRent]=await Promise.all([rpc.getGenesisHash(),
 rpc.getMinimumBalanceForRentExemption(36),rpc.getMinimumBalanceForRentExemption(45+bytes),
 rpc.getMinimumBalanceForRentExemption(37+bytes),rpc.getMinimumBalanceForRentExemption(177)]);
const estimate=estimateProgram({name:'merged-router',bytes});
if(program+programData!==estimate.lockedLamports)throw Error('Rent assumption changed; update estimate.');
const locked=program+programData,fees=25000000,margin=250000000,initialization=50000000,canary=50000000,reserve=3000000000;
const result={schemaVersion:2,observedAt:new Date().toISOString(),cluster:'mainnet-beta',genesisHash,
 scope:'read-only-public-rpc-fixture-sizing',productionRelease:false,bytes,sha256:candidate.sha256,
 exactAllocation:true,programRentLamports:program,programDataRentLamports:programData,bufferRentLamports:buffer,
 lockedRentLamports:locked,richConfigAccountBytes:177,richConfigRentLamports:configRent,firstRichConfigurationRentLamports:configRent*2,
 estimatedUploadBaseFeesLamports:estimate.feeLamports,feeAllowanceLamports:fees,marginLamports:margin,
 illustrativeInitializationAllowanceLamports:initialization,illustrativeCanaryAllowanceLamports:canary,
 configuredTotalBudgetLamports:5000000000,configuredOperatingReserveLamports:reserve,
 illustrativeContractLaunchFundingLamports:locked+fees+margin+initialization+canary+reserve,
 recommendedTechnicalWalletFundingLamports:10000000000,rentFitsTotalBudget:locked<=5000000000,
 finalTransactionFeesVerified:false,deploymentAuthorized:false,
 unknown:['production binary sizing','actual initialization inventory','actual canary plan','token launch and liquidity budget'],
 excludes:['token launch and liquidity','off-chain infrastructure','independent review'],
 note:'10 SOL is a planning estimate, not an authorized spending-cap increase. Includes the existing 3 SOL operating reserve; 0.05 SOL each for setup/canary are provisional allowances. Buffer rent is reusable at fresh same-payer Loader-v3 finalization; do not add it twice as permanent rent. Final production bytes and exact transactions must be re-quoted.'};
writeFileSync('docs/evidence/mainnet-contract-rent-2026-11-22.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
