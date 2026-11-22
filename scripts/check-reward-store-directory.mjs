import {runSecurityTests} from './security-tests.mjs';

if(process.platform!=='linux'){
  process.stderr.write('Linux directory durability evidence is unavailable on this platform.\n');process.exitCode=1;
}else{
  const result=await runSecurityTests({root:process.cwd(),inventory:'config/reward-store-directory-tests.json'});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.success||result.required!==10||result.requiredPassed!==result.required)process.exitCode=1;
}
