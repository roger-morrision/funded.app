const commitmentIndex={getTransaction:1,getAccountInfo:1,getAccountInfoAndContext:1,
 getBlockSignatures:1,getSignaturesForAddress:2};

// One reconciliation pass only. Share identical explicitly finalized reads,
// including pending promises, while every new pass starts with empty evidence.
// This does not cache verifier results or replace any proof/account check.
export function createFinalizedReadCache(connection){
 const reads=new Map(),methods=new Map();
 return new Proxy(connection,{get(target,name){
  const value=Reflect.get(target,name,target);
  if(typeof value!=='function')return value;
  if(!Object.hasOwn(commitmentIndex,name))return value.bind(target);
  if(!methods.has(name))methods.set(name,(...args)=>{
   const option=args[commitmentIndex[name]];
   if((typeof option==='string'?option:option?.commitment)!=='finalized')return value.apply(target,args);
   let key;
   try{key=`${name}:${JSON.stringify(args)}`;}catch{return value.apply(target,args);}
   if(reads.has(key))return reads.get(key);
   const result=Promise.resolve().then(()=>value.apply(target,args));
   reads.set(key,result);return result;
  });
  return methods.get(name);
 }});
}
