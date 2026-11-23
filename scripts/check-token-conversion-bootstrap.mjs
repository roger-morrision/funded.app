import {runSecurityTests} from './security-tests.mjs';
const result=await runSecurityTests({root:process.cwd(),inventory:'config/token-conversion-bootstrap-tests.json'});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(!result.success||result.required!==31||result.requiredPassed!==31)process.exitCode=1;
