// Shared URL parser: never treat an invite code as a verified community name.
export function communityLink(value, type) {
  try {
    const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    const host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);
    if(type==='telegram'&&['t.me','telegram.me'].includes(host)) {
      const name=parts[0]==='s'?parts[1]:parts[0];
      if(/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name||'')&&!['joinchat','share','proxy','addstickers'].includes(name))
        return {fallback:'@'+name,url:'https://t.me/'+name};
      const invite=name==='joinchat'?parts[1]:name?.startsWith('+')?name.slice(1):null;
      if(/^[A-Za-z0-9_-]{5,80}$/.test(invite||''))return {fallback:'Telegram invite',url:'https://t.me/+'+invite};
    }
    if(type==='discord'&&['discord.gg','discord.com','discordapp.com','www.discord.com'].includes(host)) {
      const reserved=['channels','login','register','app','developers','terms','privacy','download','nitro','shop','application-directory'];
      const code=host==='discord.gg'?parts[0]:parts[0]==='invite'?parts[1]:parts.length===1&&!reserved.includes(parts[0])?parts[0]:null;
      if(/^[A-Za-z0-9_-]{2,80}$/.test(code||''))return {fallback:'Discord invite · '+code,url:'https://discord.com/api/v10/invites/'+code};
      if(parts[0]==='channels')return {fallback:'Discord channel',url:null};
    }
  } catch {}
  return null;
}
