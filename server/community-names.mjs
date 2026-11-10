import {communityLink} from '../community-link.js';
const clean=value=>typeof value==='string'?value.replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,120):'';
function entities(text){return text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,match=>{
  const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};
  if(named[match])return named[match];const n=match[2].toLowerCase()==='x'?parseInt(match.slice(3),16):parseInt(match.slice(2),10);
  return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
});}
export function telegramTitle(html){
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
    if(!/property\s*=\s*["']og:title["']/i.test(tag))continue;
    const text=clean(entities(tag.match(/content\s*=\s*(["'])(.*?)\1/i)?.[2]||''));
    if(text&&!/^(Telegram|Telegram Messenger|Telegram: Contact @)/i.test(text))return text;
  }
  return null;
}
export function createCommunityNameReader({fetchImpl=fetch,now=Date.now}={}) {
  const cache=new Map();let active=0;
  return async function read(value,type){
    const target=communityLink(value,type);if(!target?.url)return null;
    const hit=cache.get(target.url);if(hit&&hit.until>now())return hit.promise;
    if(active>=8)return null;
    const promise=(async()=>{active++;try{
      const response=await fetchImpl(target.url,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{Accept:type==='discord'?'application/json':'text/html'}});
      if(!response.ok||Number(response.headers.get('content-length'))>131072)return null;
      let text='',bytes=0;const decoder=new TextDecoder();for await(const chunk of response.body){bytes+=chunk.length;if(bytes>131072)throw Error('Response too large');text+=decoder.decode(chunk,{stream:true});}text+=decoder.decode();
      if(type==='telegram')return telegramTitle(text);
      const data=JSON.parse(text),guild=clean(data.guild?.name),channel=clean(data.channel?.name);
      return guild?(channel?guild+' · #'+channel:guild):channel||null;
    }catch{return null;}finally{active--;}})();
    if(cache.size>=500)cache.delete(cache.keys().next().value);
    cache.set(target.url,{promise,until:now()+3600000});return promise;
  };
}
