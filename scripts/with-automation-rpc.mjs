import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const rpc=(await readFile('.secrets/automation-selected-rpc-url','utf8')).trim();
const url=new URL(rpc);if(url.protocol!=='https:')throw Error('HTTPS RPC required');
process.env.FUNDED_AUTOMATION_RPC_URL=rpc;
const [script,...args]=process.argv.slice(2);if(!script)throw Error('A script is required');
process.argv=[process.argv[0],resolve(script),...args];
try{await import(pathToFileURL(resolve(script)));}catch(error){
  let message=String(error?.stack||error).replaceAll(rpc,'[redacted-rpc]');
  for(const value of url.searchParams.values())if(value.length>=8)message=message.replaceAll(value,'[redacted-key]');
  console.error(message);process.exitCode=1;
}
