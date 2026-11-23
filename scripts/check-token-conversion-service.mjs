import {runSecurityTests} from './security-tests.mjs';
const result=await runSecurityTests({root:process.cwd(),inventory:'config/token-conversion-service-tests.json'});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(!result.success||result.required!==25||result.requiredPassed!==25)process.exitCode=1;
