/**
 * Source-free FFI lifetime and Channel<T> admission references for issues
 * common #80 and Java #400. Inputs are synthetic fixture claims, never
 * compiler-authenticated capabilities or verified native-call observations.
 */
const deny=m=>{throw Error("BATCH03_DENIED: "+m)};
const requireThat=(v,m)=>{if(!v)deny(m)};
const id=s=>typeof s==="string"&&/^[A-Za-z][A-Za-z0-9_.:@-]{0,95}$/.test(s);
const shape=(x,fields,label)=>requireThat(x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===fields.slice().sort().join("|"),label+" fields");

export class FfiQuiescenceReference {
 #live=new Map();#stopped=false;#next=0;#max;
 constructor(maxConcurrent=1){
  requireThat(Number.isSafeInteger(maxConcurrent)&&maxConcurrent>=1&&maxConcurrent<=16,
   "FFI concurrency capacity");
  this.#max=maxConcurrent;
 }
 start({actor,generation,library,executor,threadAffine=false}={}){
  requireThat(!this.#stopped&&this.#live.size<this.#max,"FFI stopped/capacity");
  requireThat(id(actor)&&id(library)&&id(executor)&&
   Number.isSafeInteger(generation)&&generation>0&&
   typeof threadAffine==="boolean","FFI provenance");
  const lease=Object.freeze({ffiLease:++this.#next});
  this.#live.set(lease,{actor,generation,library,executor,threadAffine,
   cancelled:false,timedOut:false,returned:false,disposed:false});
  return lease;
 }
 #state(lease){const s=this.#live.get(lease);requireThat(s,"stale/foreign FFI lease");return s;}
 cancel(lease){this.#state(lease).cancelled=true;}
 timeout(lease){this.#state(lease).timedOut=true;}
 nativeCallback(lease){this.#state(lease);deny("FFI native guest upcalls forbidden in v1");}
 physicallyReturned(lease,{executor}={}){
  const s=this.#state(lease);
  requireThat(!s.returned,"duplicate physical FFI return");
  requireThat(!s.threadAffine||s.executor===executor,"thread-affine FFI executor");
  s.returned=true;
 }
 dispose(lease){
  const s=this.#state(lease);
  requireThat(s.returned&&!s.disposed,"FFI buffers still live or duplicate disposal");
  s.disposed=true;this.#live.delete(lease);
  return Object.freeze({publishResult:!s.cancelled&&!s.timedOut,
   retiredAfterPhysicalReturn:true});
 }
 stop(){this.#stopped=true;}
 canUnload(){return this.#live.size===0;}
 canReclaimActor(actor,generation){
  requireThat(id(actor)&&Number.isSafeInteger(generation)&&generation>0,"actor epoch");
  return ![...this.#live.values()].some(s=>s.actor===actor&&s.generation===generation);
 }
 inspect(){return Object.freeze({activeLeases:this.#live.size,stopped:this.#stopped,
  quiescent:this.canUnload(),nativeExecutionVerified:false});}
}

const SCALARS=new Set(["bool","int","float","string"]);
function safeData(t,depth=0,budget={nodes:0}){
 requireThat(depth<=32&&++budget.nodes<=256,"channel type proof budget");
 requireThat(t&&typeof t==="object"&&!Array.isArray(t),"channel payload descriptor");
 requireThat(typeof t.kind==="string","channel payload kind");
 if(t.kind==="scalar"){
  shape(t,["kind","name"],"scalar");
  return SCALARS.has(t.name);
 }
 if(t.kind==="option"||t.kind==="frozen"){
  shape(t,["kind","value"],"container");
  return safeData(t.value,depth+1,budget);
 }
 if(t.kind==="tuple"||t.kind==="record"){
  shape(t,["kind","elements"],"data aggregate");
  requireThat(Array.isArray(t.elements)&&t.elements.length>0&&
   t.elements.length<=64,"bounded channel aggregate");
  return t.elements.every(x=>safeData(x,depth+1,budget));
 }
 // Explicitly reject mutable cells, native handles, actor refs, futures,
 // callbacks, unknown nominal payload, pointer, or nested Channel.
 return false;
}

export function channelPayloadIsDataOnly(type){
 return safeData(type);
}
export class ChannelBoundaryReference {
 #tokens=new Map();#next=0;
 mint(owner,type){
  requireThat(id(owner)&&channelPayloadIsDataOnly(type),"channel payload not data-only");
  const token=Object.freeze({channel:++this.#next});
  this.#tokens.set(token,{owner,type,closed:false});
  return token;
 }
 transfer(token,{from,to,boundary,owned}={}){
  const s=this.#tokens.get(token);
  requireThat(s&&!s.closed,"stale/forged channel");
  requireThat(id(from)&&id(to)&&from!==to&&s.owner===from,
   "channel owner transfer");
  requireThat(boundary==="task"&&owned===true,
   "Channel<T> cannot cross actor or unowned async boundary");
  requireThat(channelPayloadIsDataOnly(s.type),"invalid channel type");
  s.owner=to;return token;
 }
 operation(token,owner){
  const s=this.#tokens.get(token);
  requireThat(s&&!s.closed&&id(owner)&&s.owner===owner,
   "channel owner or retired handle");
  return {nonConsumingOperation:true,guestTypechecked:false};
 }
 close(token,owner){
  this.operation(token,owner);
  this.#tokens.get(token).closed=true;
 }
}

/**
 * Linked-signature reference: rejects opaque Unknown rather than making
 * unresolved imports permissive. It cannot itself resolve source imports.
 */
export function checkLinkedSignatures({exports,imports}={}){
 requireThat(exports&&typeof exports==="object"&&!Array.isArray(exports)&&
  Array.isArray(imports)&&imports.length<=256,"import evidence shape");
 for(const call of imports){
  shape(call,["module","symbol","signature"],"import call");
  requireThat(id(call.module)&&id(call.symbol)&&id(call.signature)&&
   call.signature!=="Unknown","opaque or malformed imported signature");
  const moduleExports=exports[call.module];
  requireThat(moduleExports&&typeof moduleExports==="object"&&
   Object.hasOwn(moduleExports,call.symbol)&&
   moduleExports[call.symbol]===call.signature,
   "unresolved or mismatched linked import");
 }
 return {shapeValid:true,actualLinkedGuestExecution:false};
}
