const ID=/^[A-Za-z0-9:_./-]{1,240}$/;
export function readXPostCursor(value){
  if(value==null||value==='')return null;
  try{
    if(typeof value!=='string'||value.length>1024||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)throw new Error();
    const result=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(result)||result.length!==2||typeof result[0]!=='string'||typeof result[1]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(result[0])
      ||!Number.isFinite(Date.parse(result[0]))||new Date(result[0]).toISOString()!==result[0].slice(0,23)+'Z'||!ID.test(result[1]))throw new Error();
    return result;
  }catch{throw new Error('Invalid X review page cursor.');}
}
export const writeXPostCursor=(at,id)=>Buffer.from(JSON.stringify([at,id])).toString('base64url');
