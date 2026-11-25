/**
 * Proposal-only typed actor pipeline validation, not runtime authorization.
 * Input remains caller-owned/mutable. Consumers must use the immutable contract
 * returned by admitPipelineContract() for any downstream construction decision.
 * Proxies are not a trusted input boundary.
 */
const typePattern=/^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*$/;
export const PIPELINE_BACKENDS=Object.freeze(['java-graalvm','llvm','wasm','browser-worker']);
export const PIPELINE_OPERATIONS=Object.freeze({forward:'self.forward',backward:'self.backward'});
const allowed=(v,keys)=>Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
function plain(v,keys){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)return false;
 if(!allowed(v,keys))return false;
 return Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
}
function dense(v,min,max){
 if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length<min||v.length>max)return false;
 if(Reflect.ownKeys(v).length!==v.length+1)return false;
 for(let i=0;i<v.length;i++){
  const d=Object.getOwnPropertyDescriptor(v,String(i));
  if(!d||!Object.hasOwn(d,'value'))return false;
 }
 return true;
}
const typeName=v=>typeof v==='string'&&v.length<=128&&typePattern.test(v);
function check(contract){
 const errors=[];
 const err=x=>errors.push(x);
 if(!plain(contract,['schemaVersion','kind','operations','semantics','stages','edges','confirmedBackends','pendingBackends']))return {ok:false,errors:['pipeline requires closed own-data object']};
 if(contract.schemaVersion!==1||contract.kind!=='typed-actor-pipeline-proposal-v1')err('unknown pipeline contract version');
 const ops=contract.operations;
 if(!plain(ops,['forward','backward'])||ops.forward!==PIPELINE_OPERATIONS.forward||ops.backward!==PIPELINE_OPERATIONS.backward)err('required first-class self.forward/self.backward operations missing');
 const sem=contract.semantics;
 if(!plain(sem,['forwardAcknowledges','backwardCorrelation','supervisorDataRouting','generationFencing','atomicPublication'])||
  sem.forwardAcknowledges!=='mailbox-admission'||sem.backwardCorrelation!=='explicit'||sem.supervisorDataRouting!==false||
  sem.generationFencing!==true||sem.atomicPublication!==true)err('unsupported pipeline semantics');
 if(!dense(contract.confirmedBackends,0,0)||!dense(contract.pendingBackends,PIPELINE_BACKENDS.length,PIPELINE_BACKENDS.length)||
  !PIPELINE_BACKENDS.every((name,i)=>contract.pendingBackends[i]===name))err('unverified backends must stay pending');
 const stages=contract.stages,edges=contract.edges;
 if(!dense(stages,3,32))err('stages must be dense with 3..32 entries');
 if(!dense(edges,2,31))err('edges must be dense with 2..31 entries');
 if(errors.length)return {ok:false,errors};
 if(edges.length!==stages.length-1)err('only exactly connected acyclic linear chains are supported');
 const ids=new Set();
 for(let i=0;i<stages.length;i++){
  const s=stages[i];
  if(!plain(s,['id','role','forwardIn','forwardOut','backwardIn','backwardOut'])){err("stage["+i+"] must have closed own-data shape");continue}
  if(typeof s.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(s.id)||ids.has(s.id))err("stage["+i+"] invalid or duplicate ID");
  ids.add(s.id);
  const expected=i===0?'readable':i===stages.length-1?'writable':'transform';
  if(s.role!==expected)err("stage["+i+"] requires "+expected+" role; ordinary/supervisor excluded");
  for(const field of ['forwardIn','forwardOut','backwardIn','backwardOut'])
   if(s[field]!==null&&!typeName(s[field]))err("stage["+i+"] invalid "+field+" nominal type");
  const requiredNull=i===0?['forwardIn','backwardOut']:i===stages.length-1?['forwardOut','backwardIn']:[];
  for(const field of requiredNull)if(s[field]!==null)err("stage["+i+"] "+field+" must be null");
  const requiredType=i===0?['forwardOut','backwardIn']:i===stages.length-1?['forwardIn','backwardOut']:['forwardIn','forwardOut','backwardIn','backwardOut'];
  for(const field of requiredType)if(!typeName(s[field]))err("stage["+i+"] requires "+field);
 }
 // Never dereference fields on invalid stages, including accessor-backed inputs.
 if(errors.length)return {ok:false,errors};
 for(let i=0;i<edges.length;i++){
  const e=edges[i];
  if(!plain(e,['from','to','forwardType','backwardType','capacity'])){err("edge["+i+"] must have closed own-data shape");continue}
  const from=stages[i],to=stages[i+1];
  if(!from||!to||e.from!==from.id||e.to!==to.id)err("edge["+i+"] must connect adjacent stages in order");
  if(!typeName(e.forwardType)||!typeName(e.backwardType))err("edge["+i+"] requires nominal typed bidirectional payloads");
  if(from&&to&&e.forwardType!==from.forwardOut||e.forwardType!==to.forwardIn)err("edge["+i+"] self.forward direction/type mismatch");
  if(from&&to&&e.backwardType!==to.backwardOut||e.backwardType!==from.backwardIn)err("edge["+i+"] self.backward direction/type mismatch");
  if(!Number.isSafeInteger(e.capacity)||e.capacity<1||e.capacity>256)err("edge["+i+"] invalid bounded mailbox capacity");
 }
 return {ok:errors.length===0,errors};
}
export function validatePipelineContract(contract){
 try{return check(contract)}catch{return {ok:false,errors:['invalid or hostile pipeline contract input']}}
}
