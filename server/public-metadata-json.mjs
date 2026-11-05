import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,prefix,'ipv4');
const globalV6 = new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
const blockedV6 = new BlockList();
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blockedV6.addSubnet(address,prefix,'ipv6');

export function publicMetadataAddress(address) {
  const family=isIP(address);
  return family===4 ? !blocked.check(address,'ipv4') : family===6 && globalV6.check(address,'ipv6') && !blockedV6.check(address,'ipv6');
}

export function publicMetadataUrl(value) {
  if (typeof value!=='string' || value.length>2048) return null;
  let text=value.trim();
  if (text.startsWith('ipfs://')) text='https://ipfs.io/ipfs/'+text.slice(7).replace(/^ipfs\//,'');
  if (text.startsWith('ar://')) text='https://arweave.net/'+text.slice(5);
  try {
    const url=new URL(text),host=url.hostname.replace(/^\[|\]$/g,'');
    if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !host.includes('.') && !isIP(host)
      || /(^|\.)(localhost|local|internal|lan)$/.test(host) || isIP(host) && !publicMetadataAddress(host)) return null;
    return url.href;
  } catch { return null; }
}

// Resolve and pin a public address for this request. No redirects, credentials,
// or unrestricted server-side fetches of token-controlled URLs.
export function readPublicMetadataJson(uri) {
  const url=publicMetadataUrl(uri);
  if (!url) return Promise.reject(new Error('Unsupported public metadata URL'));
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{signal:AbortSignal.timeout(5000),headers:{accept:'application/json'},
      lookup(host,options,callback){
        lookup(host,{all:true,verbatim:true}).then(addresses=>{
          if (!addresses.length || addresses.some(row=>!publicMetadataAddress(row.address))) return callback(new Error('Metadata host is not public'));
          const selected=addresses[0];
          if (options.all) callback(null,[selected]);else callback(null,selected.address,selected.family);
        },callback);
      }},response=>{
      if (response.statusCode!==200 || Number(response.headers['content-length'])>65536) {response.destroy();reject(new Error('Metadata unavailable'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>65536){response.destroy(new Error('Metadata too large'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{try{const json=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!json||typeof json!=='object'||Array.isArray(json))throw Error('Invalid metadata');resolve(json);}catch(error){reject(error);}});
    });
    request.on('error',reject);
  });
}
