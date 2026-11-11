#!/usr/bin/env node
// Differential ordering oracle. Not a physical-release attestation or .atto execution.
import {readFileSync} from "node:fs";
function validate(trace) {
  const fail = why => {throw Error("BAD_TRACE: " + why);};
  if (trace?.schema !== "attolang.supervisor.differential_trace.v1" ||
      trace.scenario !== "nested_supervisor_crash_while_data_inflight" ||
      !["reference","java","llvm","net","wasm","forge"].includes(trace.backend) ||
      trace.execution_class !== (trace.backend === "reference" ?
        "SYNTHETIC_REFERENCE" : "UNVERIFIED_BACKEND_TRACE") ||
      Object.keys(trace).sort().join(",") !==
        "backend,events,execution_class,scenario,schema") fail("schema/false certification");
  if (!Array.isArray(trace.events) || trace.events.length < 10 ||
      trace.events.length > 4096) fail("event count");
  const known=new Map(),latest=new Map(),tickets=new Map(),notices=new Map(),faults=new Set();
  const key=(a,g)=>a+"@"+g;
  const inc=e=>{const x=known.get(key(e.actor,e.generation));if(!x)fail("unknown epoch");return x;};
  function below(child,parent) {
    let x=child,depth=0;
    while(x?.parentKey) {
      if(++depth>64)fail("lineage cycle");
      if(x.parentKey===parent.key)return true;
      x=known.get(x.parentKey);
      if(!x)fail("missing ancestor");
    }
    return false;
  }
  let seq=0,firstFence=Infinity,sibling=false,restarts=0;
  for(const e of trace.events) {
    if(!Number.isSafeInteger(e.seq)||e.seq<=seq)fail("nonmonotonic sequence");
    seq=e.seq;
    switch(e.kind) {
      case "PUBLISH": {
        if(!/^[a-z0-9_]+$/.test(e.actor??"")||e.actor==="root"||
           !Number.isSafeInteger(e.generation)||e.generation<=0||
           known.has(key(e.actor,e.generation)))fail("bad identity");
        const parent=e.parent==="root"?null:latest.get(e.parent);
        if(e.parent!=="root"&&(!parent||parent.fenced||parent.retired))fail("fenced parent");
        const old=latest.get(e.actor);
        if(old) {
          const oldParent=old.parentKey?known.get(old.parentKey)?.actor:"root";
          if(e.parent!==oldParent)fail("unauthorized restart reparent");
          if(e.generation<=old.generation||!old.retired||!old.released)
            fail("restart before physical release");
          for(const c of known.values())if(below(c,old)&&!c.released)fail("orphan descendant");
          for(const n of notices.values())
            if(n.failed===old.key&&!n.acked)fail("unacknowledged supervisor restart");
          restarts++;
        }
        const node={key:key(e.actor,e.generation),actor:e.actor,
          generation:e.generation,parentKey:parent?.key??null,
          fenced:false,retired:false,released:false};
        known.set(node.key,node);latest.set(e.actor,node);break;
      }
      case "DATA_ADMIT": {
        const x=inc(e);
        if(x.fenced||x.retired||latest.get(e.actor)!==x)fail("post-fence DATA");
        if(typeof e.ticket!=="string"||!e.ticket||tickets.has(e.ticket))fail("DATA replay");
        tickets.set(e.ticket,{actor:x,settled:false});break;
      }
      case "DATA_SETTLE": {
        const p=tickets.get(e.ticket);
        if(!p||p.actor!==inc(e)||p.settled||
           !["processed","aborted"].includes(e.outcome))fail("unaccounted DATA");
        p.settled=true;
        if(e.actor==="b1"&&e.outcome==="processed"&&e.seq>firstFence)sibling=true;
        break;
      }
      case "FAIL": {
        const x=inc(e);
        if(x.retired||faults.has(x.key)||
           !["PANIC","RAISE","UNCAUGHT_THROW","STACK_OVERFLOW"].includes(e.failure_kind))
          fail("forged terminal");
        faults.add(x.key);break;
      }
      case "FENCE": {
        const x=inc(e);
        if(!faults.has(x.key)||x.fenced)fail("unauthorized fence");
        firstFence=Math.min(firstFence,e.seq);
        for(const c of known.values())if(c===x||below(c,x))c.fenced=true;
        break;
      }
      case "CONTROL_NOTICE": {
        const x=inc(e);
        if(!faults.has(x.key)||typeof e.notice!=="string"||
           notices.has(e.notice)||e.controller!=="root")fail("forged notice");
        notices.set(e.notice,{failed:x.key,controller:e.controller,decided:false,acked:false});
        break;
      }
      case "RETIRE": {
        const x=inc(e);if(!x.fenced||x.retired)fail("unfenced retirement");
        x.retired=true;break;
      }
      case "PHYSICAL_RELEASE": {
        const x=inc(e);
        if(!x.retired||x.released||e.active_loans!==0||
           typeof e.receipt_source!=="string"||!e.receipt_source)fail("unsafe physical receipt");
        for(const p of tickets.values())if(p.actor===x&&!p.settled)fail("outstanding DATA");
        x.released=true;break;
      }
      case "DECISION": {
        const n=notices.get(e.notice);
        if(!n||n.decided||n.controller!==e.controller||e.decision!=="restart")
          fail("forged decision");
        n.decided=true;break;
      }
      case "CONTROL_ACK": {
        const n=notices.get(e.notice);
        if(!n||!n.decided||n.acked||n.controller!==e.controller)fail("stale ACK");
        n.acked=true;break;
      }
      default:fail("unknown event");
    }
  }
  if([...tickets.values()].some(p=>!p.settled)||
     [...faults].some(f=>![...notices.values()].some(n=>n.failed===f&&n.acked))||
     !sibling||!restarts)fail("missing terminal/sibling/restart witness");
  return {events:trace.events.length,restarts,classification:"ORDERING_ONLY_NOT_CERTIFIED"};
}
const reference=JSON.parse(readFileSync(new URL("./nested_supervisor_crash.trace.reference.json",import.meta.url),"utf8"));
const positive=validate(reference);
const mutations=[
  t=>t.execution_class="CERTIFIED",
  t=>t.events[17].actor="a1",
  t=>t.events[15].generation=1,
  t=>t.events.splice(12,1),
  t=>t.events[14].kind="PUBLISH",
  t=>t.events[10].active_loans=1,
  t=>t.events[7].controller="s2",
  t=>t.events[8].ticket="unreserved",
  t=>t.events[16].parent="s2",
  t=>t.events.splice(14,1),
  t=>t.events[2].generation=0,
  t=>t.events.splice(17,0,{seq:17.5,kind:"DATA_ADMIT",actor:"a1",generation:2,ticket:"fake"})
];
for(const edit of mutations) {
  const altered=structuredClone(reference);
  edit(altered);
  let rejected=false;try{validate(altered);}catch{rejected=true;}
  if(!rejected)throw Error("unsafe trace mutation accepted");
}
console.log("PASS supervisor differential trace: events="+positive.events+
  " mutations="+mutations.length+" status="+positive.classification);
if(process.argv[2])console.log(JSON.stringify(validate(JSON.parse(readFileSync(process.argv[2],"utf8")))));
