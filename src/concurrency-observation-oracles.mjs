/**
 * Portable source-free reference oracles for test work items 11–20.
 *
 * These inspect supplied SYNTHETIC or untrusted event traces. They are NOT
 * guest instrumentation, an authenticated compiler receipt, deterministic
 * carrier scheduling or evidence that any Oreslang backend passes --race.
 */
const SHA=/^[0-9a-f]{40}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const PATH=/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,119}$/;
const SPAN=/^([A-Za-z0-9_][A-Za-z0-9_./-]{0,119}):([1-9][0-9]{0,6}):([1-9][0-9]{0,6})$/;
const BACKENDS=new Set(["java","llvm","js","wasm","net","forge"]);
const EDGE_KINDS=new Set(["await","tail-await","spawn","select-await","select-readch",
  "channel-send","channel-receive","actor-send","actor-receive",
  "supervisor-control","generator-resume","stream-resume","rpc-hop"]);
const fail=(message)=>{throw Error("UNTRUSTED_CONFORMANCE_TRACE: "+message);};
const requireThat=(ok,message)=>{if(!ok)fail(message);};
const obj=x=>x!==null && typeof x==="object" && !Array.isArray(x);
function exact(x,fields,label){
  requireThat(obj(x) &&
    Object.keys(x).sort().join("|") === [...fields].sort().join("|"),label+" fields");
}
function id(value,label){ requireThat(typeof value==="string"&&NAME.test(value),label+" identity");return value; }
function seq(e,index){
  requireThat(Number.isSafeInteger(e.seq) && e.seq===index+1,"noncanonical event sequence");
}
function merge(into,from){
  for(const [owner,count] of from)into.set(owner,Math.max(into.get(owner)||0,count));
}
function snapshot(clock){return new Map(clock);}
function hb(previous,current){
  for(const [owner,count] of previous){
    if((current.get(owner)||0)<count)return false;
  }
  return true;
}
function tick(clock,owner){clock.set(owner,(clock.get(owner)||0)+1);}
function traceHeader(trace,max){
  exact(trace,["schema","sourceTree","roots","events"],"trace");
  requireThat(trace.schema===1 && typeof trace.sourceTree==="string" &&
    SHA.test(trace.sourceTree),"exact source tree");
  requireThat(Array.isArray(trace.roots)&&trace.roots.length>0&&
    trace.roots.length<=64,"root owners");
  const roots=new Set(trace.roots.map(x=>id(x,"root")));
  requireThat(roots.size===trace.roots.length,"duplicate root identity");
  requireThat(Array.isArray(trace.events)&&trace.events.length>0&&
    trace.events.length<=max,"bounded trace events");
  return roots;
}
const eventFields={
  read:["seq","owner","op","domain","allocation","generation","place","span"],
  write:["seq","owner","op","domain","allocation","generation","place","span"],
  acquire:["seq","owner","op","lock"],release:["seq","owner","op","lock"],
  send:["seq","owner","op","message"],recv:["seq","owner","op","message"],
  spawn:["seq","owner","op","child"],join:["seq","owner","op","child"],
  done:["seq","owner","op"],cancel:["seq","owner","op"]
};
/**
 * Derive logical vector clocks from a fully supplied event sequence.
 * Logical scheduling order in this array alone does NOT establish happens-before.
 * No clock may be supplied by the caller. Cancellation is never a join.
 */
export function auditMemoryTrace(trace){
  const roots=traceHeader(trace,4096);
  const states=new Map([...roots].map(x=>[x,{clock:new Map(),closed:false}]));
  const locks=new Map(), messages=new Map(), accesses=new Map(), races=[];
  const spawnOwners=new Map(),joined=new Set();
  for(const [index,event] of trace.events.entries()){
    requireThat(obj(event)&&Object.hasOwn(eventFields,event.op),"unknown memory-trace operation");
    exact(event,eventFields[event.op],"memory event");
    seq(event,index); const who=id(event.owner,"event owner");
    const state=states.get(who);
    requireThat(state&&!state.closed,"unregistered or terminated owner");
    const clock=state.clock;
    switch(event.op){
      case "spawn": {
        const child=id(event.child,"spawn child");
        requireThat(!states.has(child)&&states.size<64,"duplicate/unbounded spawned child");
        tick(clock,who);
        states.set(child,{clock:snapshot(clock),closed:false});
        spawnOwners.set(child,who);
        break;
      }
      case "join": {
        const child=id(event.child,"join child");
        const childState=states.get(child);
        requireThat(child!==who&&childState?.closed===true,"join requires physically exited child");
        requireThat(spawnOwners.get(child)===who&&!joined.has(child),
          "join requires unique original owning spawner");
        joined.add(child);
        merge(clock,childState.clock);tick(clock,who);
        break;
      }
      case "done":
        requireThat(![...locks.values()].some(x=>x.holder===who),
          "owner exits holding a lock");
        tick(clock,who);state.closed=true;break;
      case "cancel":tick(clock,who);break;
      case "acquire": {
        const lock=id(event.lock,"lock");
        const record=locks.get(lock)||{holder:null,release:new Map()};
        requireThat(record.holder===null,"overlapping or reentrant lock acquire");
        merge(clock,record.release);tick(clock,who);
        record.holder=who;locks.set(lock,record);break;
      }
      case "release": {
        const lock=id(event.lock,"lock");
        const record=locks.get(lock);
        requireThat(record?.holder===who,"release without owner");
        tick(clock,who);record.holder=null;record.release=snapshot(clock);break;
      }
      case "send": {
        const key=id(event.message,"message");
        requireThat(!messages.has(key),"duplicate message identity");
        tick(clock,who);
        messages.set(key,{clock:snapshot(clock),received:false});break;
      }
      case "recv": {
        const key=id(event.message,"message");
        const m=messages.get(key);
        requireThat(m&&!m.received,"receive without exactly one send");
        merge(clock,m.clock);tick(clock,who);m.received=true;break;
      }
      case "read": case "write": {
        for(const k of ["domain","allocation","place"]) id(event[k],k);
        requireThat(Number.isSafeInteger(event.generation)&&event.generation>0,
          "invalid allocation generation");
        requireThat(typeof event.span==="string"&&SPAN.test(event.span) &&
          !event.span.includes(".."),"unsafe source span");
        tick(clock,who);
        const location=[event.domain,event.allocation,event.generation,event.place].join("|");
        const previous=accesses.get(location)||[];
        for(const old of previous){
          if((old.op==="write"||event.op==="write") &&
             old.owner!==who && !hb(old.clock,clock)){
            races.push({earlier:old.seq,later:event.seq,location,
              earlierOwner:old.owner,laterOwner:who,
              earlierSpan:old.span,laterSpan:event.span});
          }
        }
        previous.push({seq:event.seq,op:event.op,clock:snapshot(clock),owner:who,span:event.span});
        accesses.set(location,previous);
        break;
      }
    }
    requireThat(races.length<=4096,"race finding budget exceeded");
  }
  return {schema:1,classification:"SOURCE_FREE_ORACLE_ONLY",
    guestInstrumentation:"NOT_ESTABLISHED",sourceTree:trace.sourceTree,
    eventCount:trace.events.length,races};
}

/**
 * Task/scope reference automaton. A cancel signal is not physical exit.
 * A scope cannot report done until ALL registered tasks physically exit.
 */
export function auditTaskTrace(trace){
  exact(trace,["schema","sourceTree","scope","events"],"Task trace");
  requireThat(trace.schema===1 && SHA.test(trace.sourceTree||""),"Task source tree");
  id(trace.scope,"Task scope");
  requireThat(Array.isArray(trace.events)&&trace.events.length>0&&
    trace.events.length<=4096,"Task event budget");
  const allowed={
    register:["seq","task","op","parent"],
    start:["seq","task","op"],cancel:["seq","task","op"],
    physical_exit:["seq","task","op"],
    get_done:["seq","task","op"],
    scope_done:["seq","task","op"]
  };
  const tasks=new Map();let scopeDone=false;let cancellations=0;
  for(const [index,e] of trace.events.entries()){
    requireThat(obj(e)&&Object.hasOwn(allowed,e.op),"unknown Task operation");
    exact(e,allowed[e.op],"Task event");seq(e,index);id(e.task,"Task");
    requireThat(!scopeDone,"event after scope completion");
    if(e.op==="register"){
      requireThat(!tasks.has(e.task)&&tasks.size<512,"duplicate/unbounded Task");
      requireThat(e.parent===null ||
        (typeof e.parent==="string"&&tasks.has(e.parent)&&
         !tasks.get(e.parent).exited),"unowned or exited Task parent");
      requireThat(e.parent!==e.task,"Task ownership cycle");
      tasks.set(e.task,{parent:e.parent,started:false,exited:false,
        cancelled:false,observed:false});continue;
    }
    if(e.op==="scope_done"){
      requireThat(e.task===trace.scope,"scope completion owner mismatch");
      requireThat(tasks.size>0&&[...tasks.values()].every(s=>s.exited),
        "scope completed before physical child exits");
      scopeDone=true;continue;
    }
    const task=tasks.get(e.task);
    requireThat(task,"unknown Task identity");
    switch(e.op){
      case "start":
        requireThat(!task.started&&!task.exited&&!task.cancelled,
          "start after cancellation, exit or repeated start");
        task.started=true;break;
      case "cancel":
        requireThat(!task.exited,"cancel after physical exit");
        task.cancelled=true;cancellations++;break;
      case "physical_exit":
        requireThat(!task.exited,"duplicate physical exit");
        task.exited=true;break;
      case "get_done":
        requireThat(task.exited,"get_done before physical exit");
        for(const [candidateName,candidate] of tasks){
          let parent=candidate.parent;
          while(parent!==null){
            if(parent===e.task){
              requireThat(candidate.exited,"get_done before descendant quiescence");
              break;
            }
            parent=tasks.get(parent)?.parent??null;
          }
        }
        requireThat(!task.observed,"duplicate get_done observation");
        task.observed=true;break;
    }
  }
  return {schema:1,classification:"SOURCE_FREE_ORACLE_ONLY",
    sourceTaskExecution:"NOT_ESTABLISHED",taskCount:tasks.size,
    cancellationSignals:cancellations,
    physicallyExited:[...tasks.values()].filter(t=>t.exited).length,
    scopeDone};
}

/** A bounded typed, payload-free causal diagnostic format, not backend parity. */
export function auditCausalDiagnostic(d){
  exact(d,["schema","backend","sourceTree","errorCode","frames","truncated"],"diagnostic");
  requireThat(d.schema===1 && BACKENDS.has(d.backend) &&
    SHA.test(d.sourceTree||""),"diagnostic backend/source");
  requireThat(typeof d.errorCode==="string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(d.errorCode),"unsafe diagnostic error code");
  requireThat(typeof d.truncated==="boolean" &&
    Array.isArray(d.frames) && d.frames.length>0 &&
    d.frames.length<=64,"bounded causal frames");
  for(const f of d.frames){
    exact(f,["kind","file","line","column","correlation"],"causal frame");
    requireThat(EDGE_KINDS.has(f.kind),"unknown causal boundary");
    requireThat(typeof f.file==="string"&&PATH.test(f.file)&&
      !f.file.startsWith("/")&&!f.file.includes("..")&&
      !f.file.includes("//"),"unsafe causal source filename");
    requireThat(Number.isSafeInteger(f.line)&&f.line>0&&f.line<=10000000 &&
      Number.isSafeInteger(f.column)&&f.column>0&&f.column<=10000000,
      "causal source coordinates");
    id(f.correlation,"opaque causal correlation");
  }
  requireThat(d.frames.length<64||d.truncated===true,
    "max-depth causal diagnostic without truncation marker");
  return {schema:1,classification:"STRUCTURAL_ONLY",
    guestErrorLineage:"NOT_ESTABLISHED",backend:d.backend,
    frames:d.frames.length,truncated:d.truncated};
}


/**
 * Conservative observed-wait graph reference.
 * ANY/select, externally completable, and timeout waits are NOT mandatory
 * blocking edges; excluding them can miss real deadlocks but cannot turn them
 * into false "definite" deadlocks. Even closed cycles here are observations.
 */
export function auditWaitGraph(graph){
  exact(graph,["schema","sourceTree","participants","waits"],"wait graph");
  requireThat(graph.schema===1&&SHA.test(graph.sourceTree||""),"wait graph source");
  requireThat(Array.isArray(graph.participants)&&
    graph.participants.length>0&&graph.participants.length<=128,"wait participants");
  const participants=new Set(graph.participants.map(x=>id(x,"wait participant")));
  requireThat(participants.size===graph.participants.length,"duplicate participant");
  requireThat(Array.isArray(graph.waits)&&graph.waits.length<=128,"wait budget");
  const entries=new Map(),eligible=new Map();
  for(const w of graph.waits){
    exact(w,["owner","dependencies","mode","state","timeout","external"],"wait entry");
    const who=id(w.owner,"wait owner");
    requireThat(participants.has(who)&&!entries.has(who),"foreign/duplicate waiter");
    requireThat(Array.isArray(w.dependencies)&&
      w.dependencies.length>0&&w.dependencies.length<=32,"wait dependencies");
    const deps=w.dependencies.map(x=>id(x,"wait dependency"));
    requireThat(new Set(deps).size===deps.length &&
      deps.every(x=>participants.has(x)),"duplicate or unknown wait dependency");
    requireThat(["ALL","ANY"].includes(w.mode)&&
      ["pending","cancelled","completed"].includes(w.state)&&
      typeof w.timeout==="boolean"&&typeof w.external==="boolean",
      "wait completion semantics");
    entries.set(who,w);
    // No OR-select, timeout, cancelled, completed or external-producer edge
    // can be required for a conservative wait-cycle witness.
    if(w.state==="pending"&&w.mode==="ALL"&&!w.timeout&&!w.external)
      eligible.set(who,deps);
  }
  // Only currently blocked tasks may close a fully observed dependency cycle.
  const edges=new Map([...eligible].map(([who,deps])=>
    [who,deps.filter(dep=>eligible.has(dep))]));
  const seenCycles=new Set(),cycles=[];
  for(const origin of [...edges.keys()].sort()){
    const stack=[{node:origin,path:[origin]}];
    let budget=100000;
    while(stack.length){
      requireThat(--budget>0,"wait-cycle search budget exhausted");
      const {node,path}=stack.pop();
      for(const next of edges.get(node)||[]){
        if(next===origin){
          const cycle=path;
          const rots=cycle.map((_,i)=>[...cycle.slice(i),...cycle.slice(0,i)].join("|"));
          const canonical=rots.sort()[0];
          if(!seenCycles.has(canonical)){
            seenCycles.add(canonical);
            cycles.push([...canonical.split("|"),canonical.split("|")[0]]);
            requireThat(cycles.length<=128,"wait-cycle finding budget");
          }
        }else if(!path.includes(next)&&path.length<129){
          stack.push({node:next,path:[...path,next]});
        }
      }
    }
  }
  return {schema:1,classification:"POTENTIAL_OBSERVED_CYCLES_ONLY",
    definiteDeadlock:"NOT_PROVEN",sourceWaitInstrumentation:"NOT_ESTABLISHED",
    participantCount:participants.size,pendingWaits:[...entries.values()]
      .filter(w=>w.state==="pending").length,
    conservativeWaitCycles:cycles.sort((a,b)=>a.join("|").localeCompare(b.join("|")))};
}
