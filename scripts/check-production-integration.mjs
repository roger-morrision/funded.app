import {runSecurityTests} from './security-tests.mjs';
const result=await runSecurityTests({root:process.cwd(),inventory:'config/production-integration-tests.json'});
console.log(JSON.stringify({...result,scope:'Local production conversion HTTP, exact message/signature, durable journal and recovery acceptance with actual candidate ELF and mocked chain; not live Mainnet acceptance'},null,2));
if(!result.success)process.exitCode=1;
