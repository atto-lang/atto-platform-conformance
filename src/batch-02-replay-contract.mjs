/**
 * Strict, source-free replay trace shape guard. The Java linker must still
 * independently hash the real reachable source closure; this guard cannot
 * inspect guest sources, authenticate JSON or reproduce carrier scheduling.
 */
const SHA=/^[0-9a-f]{64}$/;
const GIT=/^[0-9a-f]{40}$/;
const PATH=/^[a-zA-Z0-9_./+-]{1,256}$/;
const ID=/^[a-zA-Z0-9_:.-]{1,100}$/;
const IMPORT=/^[a-zA-Z0-9_./+@:-]{1,160}$/;
function ensure(p,m){if(!p)throw Error(m);}
function keys(v,expected,label){
  ensure(v!==null&&typeof v==="object"&&!Array.isArray(v),label+" object");
  ensure(Object.keys(v).sort().join("|")===expected.slice().sort().join("|"),
    label+" fields");
}
function sourceManifest(m){
  keys(m,["schema","entry","units","edges","sourceClosureSha256","sourceTree"],"closure");
  ensure(m.schema===1 && typeof m.sourceClosureSha256==="string"&&
    SHA.test(m.sourceClosureSha256)&&GIT.test(m.sourceTree||""),"source closure digest");
  ensure(PATH.test(m.entry)&&!m.entry.includes("..")&&!m.entry.startsWith("/"),
    "unsafe entry source path");
  ensure(Array.isArray(m.units)&&m.units.length>=1&&m.units.length<=512,"unit budget");
  const units=new Map();
  for(const u of m.units){
    keys(u,["path","sha256"],"source unit");
    ensure(typeof u.path==="string"&&PATH.test(u.path)&&
      !u.path.includes("..")&&!u.path.startsWith("/")&&
      typeof u.sha256==="string"&&SHA.test(u.sha256),"unsafe source unit");
    ensure(!units.has(u.path),"duplicate source unit");
    units.set(u.path,u.sha256);
  }
  ensure(units.has(m.entry),"missing entry source");
  ensure(Array.isArray(m.edges)&&m.edges.length<=2048,"import edge budget");
  const seen=new Set(),next=new Map();
  for(const e of m.edges){
    keys(e,["from","specifier","to"],"import edge");
    ensure(units.has(e.from)&&units.has(e.to)&&
      typeof e.specifier==="string"&&IMPORT.test(e.specifier)&&
      !e.specifier.includes("..")&&!e.specifier.startsWith("/")&&
      !e.specifier.includes("//"),
      "unresolved import edge");
    const key=JSON.stringify([e.from,e.specifier]);
    ensure(!seen.has(key),"duplicate import resolution");
    seen.add(key);
    if(!next.has(e.from))next.set(e.from,[]);
    next.get(e.from).push(e.to);
  }
  const visited=new Set([m.entry]),pending=[m.entry];
  while(pending.length){
    const u=pending.pop();
    for(const v of next.get(u)||[]){
      if(!visited.has(v)){visited.add(v);pending.push(v);}
    }
  }
  ensure(visited.size===units.size,"unreachable unit in claimed import closure");
  return units.size;
}
function decisions(t){
  keys(t,["schema","sourceTree","sourceClosureSha256","runtimeSha256","seed",
    "complete","decisions"],"schedule trace");
  ensure(t.schema===1&&GIT.test(t.sourceTree||"")&&SHA.test(t.sourceClosureSha256||"")&&
    SHA.test(t.runtimeSha256||""),"schedule identity digest");
  ensure(Number.isSafeInteger(t.seed)&&t.seed>=0&&t.seed<=0xffffffff,
    "seed");
  ensure(t.complete===true,"incomplete schedule trace");
  ensure(Array.isArray(t.decisions)&&t.decisions.length>0&&
    t.decisions.length<=4096,"bounded schedule decisions");
  for(const [index,d] of t.decisions.entries()){
    keys(d,["index","operation","alternatives","chosen","logicalTime"],"schedule decision");
    ensure(d.index===index&&typeof d.operation==="string"&&ID.test(d.operation),
      "schedule index/operation");
    ensure(Number.isSafeInteger(d.logicalTime)&&d.logicalTime>=0,"logical time");
    ensure(Array.isArray(d.alternatives)&&d.alternatives.length>=1&&
      d.alternatives.length<=64&&d.alternatives.every(x=>typeof x==="string"&&ID.test(x)) &&
      new Set(d.alternatives).size===d.alternatives.length,
      "schedule alternatives");
    ensure(typeof d.chosen==="string"&&d.alternatives.includes(d.chosen),
      "unavailable schedule choice");
    if(index>0)ensure(d.logicalTime>=t.decisions[index-1].logicalTime,
      "nonmonotonic logical time");
  }
}
/**
 * Compares two fully captured input records only. Replay success does NOT
 * certify that the actual guest scheduler followed these choices.
 */
export function auditReplayContract({manifest,recorded,replayed}={}){
  const units=sourceManifest(manifest);
  decisions(recorded);
  decisions(replayed);
  ensure(recorded.sourceTree===manifest.sourceTree&&
    recorded.sourceClosureSha256===manifest.sourceClosureSha256,
    "record source closure mismatch");
  ensure(replayed.sourceTree===manifest.sourceTree&&
    replayed.sourceClosureSha256===manifest.sourceClosureSha256,
    "replay source closure mismatch");
  ensure(replayed.runtimeSha256===recorded.runtimeSha256 &&
    replayed.seed===recorded.seed,"runtime/seed drift");
  ensure(replayed.decisions.length===recorded.decisions.length,
    "truncated or extended replay");
  for(let i=0;i<recorded.decisions.length;i++){
    const a=recorded.decisions[i],b=replayed.decisions[i];
    ensure(a.index===b.index&&a.operation===b.operation&&
      a.logicalTime===b.logicalTime &&
      JSON.stringify(a.alternatives)===JSON.stringify(b.alternatives) &&
      a.chosen===b.chosen,"replay diverged at decision "+i);
  }
  return {classification:"SOURCE_FREE_TRACE_SHAPE_ONLY",sourceUnits:units,
    inputTraceShapeMatches:true,guestReplayVerified:false,
    importedSourcesRehashedByCompiler:"NOT_ATTESTED"};
}
