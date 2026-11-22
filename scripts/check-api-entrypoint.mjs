import {runSecurityTests} from './security-tests.mjs';

const result=await runSecurityTests({root:process.cwd(),inventory:'config/api-entrypoint-tests.json'});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(!result.success||result.required!==5||result.requiredPassed!==5)process.exitCode=1;
