import {runSecurityTests} from './security-tests.mjs';
const result=await runSecurityTests({root:process.cwd(),inventory:'config/token-conversion-restore-tests.json'});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(!result.success||result.required!==2||result.requiredPassed!==2)process.exitCode=1;
