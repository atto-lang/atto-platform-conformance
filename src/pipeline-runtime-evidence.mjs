/**
 * Proof-interface for the existing bounded, 3-actor Oreslang compiled guest.
 * A trace accepted here is structurally consistent with the five-hop protocol,
 * NOT proof the events came from a compiler/runtime. Authenticity is supplied
 * by a separately trusted, SHA-pinned executing CI runner.
 *
 * This narrow verifier does not support multi-flow scheduling or dynamic graphs.
 */
const HOPS=Object.freeze([
  {stage:"source",variant:"Signal.Data"},
  {stage:"transform",variant:"Signal.Data"},
  {stage:"sink",variant:"Signal.Data"},
  {stage:"transform",variant:"Signal.Result"},
  {stage:"source",variant:"Signal.Result"}
]);
const SHA=/^[0-9a-f]{40}$/;
const TICKET=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const KINDS=new Set(["reserve","publish","deliver","finalize","complete","stop","restart","drop-stale"]);
function record(x,keys){
 if(!x||typeof x!=="object"||Array.isArray(x)||Object.getPrototypeOf(x)!==Object.prototype)return false;
 const fields=Reflect.ownKeys(x);
 if(fields.length!==keys.length||fields.some(k=>typeof k!=="string"||!keys.includes(k)))return false;
 return keys.every(k=>{const d=Object.getOwnPropertyDescriptor(x,k);return d&&d.enumerable&&Object.hasOwn(d,"value")});
}
function dense(x,min,max){
 if(!Array.isArray(x)||Object.getPrototypeOf(x)!==Array.prototype||x.length<min||x.length>max||Reflect.ownKeys(x).length!==x.length+1)return false;
 for(let i=0;i<x.length;i++){const d=Object.getOwnPropertyDescriptor(x,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,"value"))return false}
 return true;
}
function validate(x){
 const err=(reason)=>({ok:false,errors:[reason]});
 if(!record(x,["schemaVersion","kind","backend","sourceGitBlobSha1","events"]))return err("invalid closed trace");
 if(x.schemaVersion!==1||x.kind!=="compiled-actor-pipeline-trace-v1")return err("unsupported trace version");
 if(!["llvm-native","java-graalvm"].includes(x.backend))return err("unsupported runtime backend");
 if(typeof x.sourceGitBlobSha1!=="string"||!SHA.test(x.sourceGitBlobSha1))return err("missing source identity");
 if(!dense(x.events,1,128))return err("bounded dense event sequence required");
 let epoch=1, stopped=false, completed=false, completions=0, restarts=0, drops=0, nextHop=0;
 let currentRequest=null;
 let hops=new Map(), oldTickets=new Map();
 for(let seq=0;seq<x.events.length;seq++){
  const e=x.events[seq];
  if(!record(e,["seq","op","epoch","request","hop","ticket","stage","variant","value"]))return err("noncanonical event "+seq);
  if(e.seq!==seq||!KINDS.has(e.op))return err("unknown or nonmonotonic event "+seq);
  if(!Number.isSafeInteger(e.epoch)||e.epoch<1||e.epoch>2)return err("invalid incarnation at "+seq);
  const normal=e.op!=="restart"&&e.op!=="drop-stale";
  if(normal&&e.epoch!==epoch)return err("stale incarnation attempted an active transition at "+seq);
  if(e.op==="reserve"||e.op==="publish"||e.op==="deliver"||e.op==="finalize"){
   if(stopped||completed)return err("data transition after terminal barrier at "+seq);
   if(!Number.isSafeInteger(e.hop)||e.hop<0||e.hop>=HOPS.length)return err("invalid hop at "+seq);
   const expected=HOPS[e.hop];
   if(e.stage!==expected.stage||e.variant!==expected.variant||e.value!==null)return err("direction/type mismatch at "+seq);
   if(typeof e.request!=="string"||!TICKET.test(e.request)||typeof e.ticket!=="string"||!TICKET.test(e.ticket))return err("invalid flow identity at "+seq);
   if(currentRequest===null)currentRequest=e.request;
   if(e.request!==currentRequest)return err("cross-flow transition at "+seq);
   if(e.op==="reserve"){
    if(e.hop!==nextHop||hops.has(e.hop)|| (e.hop>0&&!["delivered","finalized"].includes(hops.get(e.hop-1)?.state)))return err("unowned or reordered reserve at "+seq);
    for(const item of hops.values())if(item.ticket===e.ticket)return err("duplicate live ticket at "+seq);
    hops.set(e.hop,{ticket:e.ticket,state:"reserved"});nextHop++;continue;
   }
   const item=hops.get(e.hop);
   if(!item||item.ticket!==e.ticket)return err("foreign or stale ticket at "+seq);
   const prior=e.op==="publish"?"reserved":e.op==="deliver"?"published":"delivered";
   if(item.state!==prior)return err("duplicate or premature "+e.op+" at "+seq);
   item.state=e.op==="publish"?"published":e.op==="deliver"?"delivered":"finalized";
   continue;
  }
  if(e.hop!==null||e.stage!==null||e.variant!==null||e.ticket!==null&&e.op!=="drop-stale")return err("unexpected control fields at "+seq);
  if(e.op==="complete"){
   if(stopped||completed||e.epoch!==epoch||e.request!==currentRequest||e.value!==19)return err("unauthorized completion at "+seq);
   if(hops.size!==5||[0,1,2,3,4].some(i=>hops.get(i)?.state!=="finalized"))return err("completion before final physical turns at "+seq);
   completed=true;completions++;continue;
  }
  if(e.value!==null||e.request!==null)return err("noncanonical lifecycle event at "+seq);
  if(e.op==="stop"){
   if(stopped)return err("duplicate stop at "+seq);
   stopped=true;continue;
  }
  if(e.op==="restart"){
   if(!stopped||e.epoch!==epoch+1||restarts!==0)return err("unauthorized restart at "+seq);
   oldTickets=new Map([...hops.values()].map(t=>[t.ticket,epoch]));
   epoch++;restarts++;stopped=false;completed=false;currentRequest=null;hops=new Map();nextHop=0;continue;
  }
  if(e.op==="drop-stale"){
   if(restarts!==1||e.epoch!==epoch-1||!oldTickets.has(e.ticket)||oldTickets.get(e.ticket)!==e.epoch)return err("unproven stale ticket at "+seq);
   oldTickets.delete(e.ticket);drops++;continue;
  }
 }
 if(!completed&&!(stopped&&hops.size>0))return err("trace lacks completion or terminal cancellation");
 // Reservation alone must never be reported as a DATA admission.
 const admitted=k=>hops.has(k)&&hops.get(k).state!=="reserved";
 return {ok:true,errors:[],forwardAdmissions:[1,2].filter(admitted).length,
  backwardAdmissions:[3,4].filter(admitted).length,completions,drops,restarts};
}
export function verifyPipelineTrace(trace){
 try{return validate(trace)}catch{return {ok:false,errors:["hostile or malformed trace"]}}
}

/** Parse only the existing native *aggregate* guest-output marker. This
 * evidence is weaker than a per-transition trace and cannot prove epoch or
 * request-correlation semantics by itself.
 */
export function verifyNativeGuestSummary(evidence){
 try{
  if(!record(evidence,["backend","sourceGitBlobSha1","exitCode","stdout","stderr"]))return {ok:false,errors:["invalid guest evidence shape"]};
  if(evidence.backend!=="llvm-native"||evidence.sourceGitBlobSha1!=="46579a917516899612fcd8c65c70b24b995c2c5a"||
   evidence.exitCode!==43||evidence.stdout!==""||
   typeof evidence.stderr!=="string"||evidence.stderr.length>131072)return {ok:false,errors:["untrusted native guest evidence"]};
  if(/SOURCE_PIPELINE_FAILURE|SOURCE_PIPELINE_TERMINAL_STATUS|SOURCE_ACTOR_INVARIANT_FAILURE/.test(evidence.stderr))return {ok:false,errors:["runtime reported terminal failure"]};
  const lines=evidence.stderr.split(/\r?\n/);
  const round=lines.filter(s=>s.startsWith("SOURCE_PIPELINE_ROUNDTRIP_PASS"));
  if(round.length!==1||round[0]!=="SOURCE_PIPELINE_ROUNDTRIP_PASS actors=3 typed=1 forward=2 backward=2 result=19")return {ok:false,errors:["missing or duplicated verified roundtrip"]};
  const stops=lines.filter(s=>s.startsWith("SOURCE_ACTOR_SPAWN_STOP_VERIFIED"));
  if(stops.length!==3)return {ok:false,errors:["physical actor shutdown evidence missing"]};
  const seen=[];
  for(const s of stops){
   const m=/^SOURCE_ACTOR_SPAWN_STOP_VERIFIED constructor_on_worker=1 released=1 processed=(\d+) last=(-?\d+)$/.exec(s);
   if(!m)return {ok:false,errors:["malformed physical stop receipt"]};
   seen.push([Number(m[1]),Number(m[2])]);
  }
  if(JSON.stringify(seen)!==JSON.stringify([[1,13],[2,14],[2,19]]))return {ok:false,errors:["wrong actor finalizers or state"]};
  const groups=lines.filter(s=>s.startsWith("SOURCE_ACTOR_GROUP_VERIFIED"));
  if(groups.length!==1||groups[0]!=="SOURCE_ACTOR_GROUP_VERIFIED active=0 slots=3 peak=3 carriers=4")return {ok:false,errors:["group shutdown not verified"]};
  // Aggregate witnesses must follow the actual runtime's publication barriers.
  // An exact finalizer multiset is insufficient if it predates completion.
  const positions=lines.map((s,i)=>({s,i}));
  const stopPositions=positions.filter(({s})=>s.startsWith("SOURCE_ACTOR_SPAWN_STOP_VERIFIED")).map(({i})=>i);
  const groupIndex=lines.indexOf(groups[0]);
  if(!(lines.indexOf(round[0])<stopPositions[0]&&stopPositions[0]<stopPositions[1]&&
    stopPositions[1]<stopPositions[2]&&stopPositions[2]<groupIndex))
    return {ok:false,errors:["invalid completion/teardown order"]};
  return {ok:true,errors:[],actors:3,forward:2,backward:2,result:19};
 }catch{return {ok:false,errors:["hostile native evidence"]}}
}
