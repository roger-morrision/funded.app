import {runSecurityTests} from './security-tests.mjs';

// Invoke the checked runner directly from a file so inherited eval-only Node
// flags cannot prevent discovery. Empty/missing required coverage is a failure.
const result=await runSecurityTests({root:process.cwd(),inventory:'config/reward-store-noop-tests.json'});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
if(!result.success||result.required<1||result.requiredPassed!==result.required)process.exitCode=1;
