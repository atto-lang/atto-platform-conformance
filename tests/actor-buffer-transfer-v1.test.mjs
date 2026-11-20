// Deliberately source-free oracle. Passing these checks is NOT evidence that
// any Oreslang backend compiles or executes guest actor-buffer transfers.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract=JSON.parse(readFileSync(
  new URL("../contracts/actor-buffer-transfer-v1.json",import.meta.url),"utf8"));
const backendNames=["java","llvm","wasm","forge","net"];
const error=(code)=>Object.assign(new Error(code),{code});
const requireThat=(truth,code)=>{if(!truth)throw error(code);};

function runCase(sample,limits=contract.limits){
  const tenants=new Map(), handles=new Map(), loans=new Map(), queues=new Map();
  const retiredActors=new Set();
  const actorKey=(tenant,actor)=>tenant+":"+actor;
  let payloadCopies=0;
  function domain(name){
    if(!tenants.has(name))
      tenants.set(name,{retired:false,used:0,slots:new Set()});
    return tenants.get(name);
  }
  function reserve(tenant,owner,size){
    const t=domain(tenant);
    requireThat(!t.retired,"RETIRED");
    requireThat(!retiredActors.has(actorKey(tenant,owner)),"RETIRED_ACTOR");
    requireThat(Number.isInteger(size)&&size>0&&
      size<=limits.perTenantBytes-t.used&&
      t.slots.size<limits.perTenantBuffers,"QUOTA");
    const slot={tenant,owner,bytes:new Uint8Array(size),generation:1,
      loans:0,live:true};
    t.slots.add(slot);t.used+=size;
    return slot;
  }
  function ref(name,actor,tenant){
    const h=handles.get(name);requireThat(h,"UNKNOWN");
    const slot=h.slot;
    requireThat(!domain(slot.tenant).retired,"RETIRED");
    requireThat(!retiredActors.has(actorKey(slot.tenant,actor)),"RETIRED_ACTOR");
    if(tenant!==undefined)requireThat(tenant===slot.tenant,"FOREIGN");
    requireThat(slot.live&&slot.generation===h.generation,"STALE");
    requireThat(slot.owner===actor,"OWNER");
    return slot;
  }
  function bounds(slot,index){
    requireThat(Number.isInteger(index)&&index>=0&&index<slot.bytes.length,"BOUNDS");
  }
  function execute(s){
    switch(s.op){
    case "alloc":{
      const slot=reserve(s.tenant,s.owner,s.size);
      handles.set(s.handle,{slot,generation:slot.generation});
      break;
    }
    case "alias":{
      const h=handles.get(s.handle);requireThat(h,"UNKNOWN");
      handles.set(s.out,{...h});break;
    }
    case "read":{
      const slot=ref(s.handle,s.as,s.tenant);
      bounds(slot,s.index);
      assert.equal(slot.bytes[s.index],s.expect);
      break;
    }
    case "write":{
      const slot=ref(s.handle,s.as,s.tenant);
      requireThat(slot.loans===0,"BORROWED");
      bounds(slot,s.index);requireThat(Number.isInteger(s.value)&&
        s.value>=0&&s.value<=255,"VALUE");
      slot.bytes[s.index]=s.value;break;
    }
    case "take":{
      const slot=ref(s.handle,s.as,s.tenant);
      requireThat(slot.loans===0,"BORROWED");
      requireThat(s.as!==s.to&&slot.generation<Number.MAX_SAFE_INTEGER,"INVALID_MOVE");
      slot.owner=s.to;slot.generation++;
      handles.set(s.out,{slot,generation:slot.generation});
      break;
    }
    case "queue_send":{
      const q=queues.get(s.queue)||{capacity:s.capacity,to:s.to,closed:false,data:[]};
      requireThat(!q.closed,"CLOSED");
      requireThat(q.capacity===s.capacity&&q.to===s.to,"INVALID_QUEUE");
      requireThat(q.data.length<q.capacity,"BACKPRESSURE");
      const slot=ref(s.handle,s.as);
      requireThat(slot.loans===0,"BORROWED");
      requireThat(s.as!==s.to&&slot.generation<Number.MAX_SAFE_INTEGER,"INVALID_MOVE");
      // Publish only after capacity, owner and borrow admission all pass.
      slot.owner=s.to;slot.generation++;
      q.data.push({slot,generation:slot.generation});
      queues.set(s.queue,q);break;
    }
    case "queue_receive":{
      const q=queues.get(s.queue);requireThat(q,"UNKNOWN");
      requireThat(!q.closed,"CLOSED");
      requireThat(q.to===s.as,"READER");
      requireThat(q.data.length>0,"EMPTY");
      handles.set(s.out,q.data.shift());break;
    }
    case "queue_close":{
      const q=queues.get(s.queue);requireThat(q,"UNKNOWN");
      if(q.closed)break;
      q.closed=true;
      for(const h of q.data){
        const slot=h.slot;
        requireThat(slot.loans===0,"BORROWED");
        if(slot.live){
          slot.bytes.fill(0);slot.live=false;
          const t=domain(slot.tenant);t.used-=slot.bytes.length;t.slots.delete(slot);
        }
      }
      q.data.length=0;break;
    }
    case "borrow":{
      const slot=ref(s.handle,s.as);
      requireThat(!loans.has(s.loan),"DUPLICATE");
      requireThat(!retiredActors.has(actorKey(slot.tenant,s.reader)),"RETIRED_ACTOR");
      slot.loans++;loans.set(s.loan,{slot,reader:s.reader,active:true});
      break;
    }
    case "loan_read":{
      const loan=loans.get(s.loan);requireThat(loan,"UNKNOWN");
      requireThat(s.as===loan.reader,"READER");
      requireThat(!domain(loan.slot.tenant).retired,"RETIRED");
      requireThat(loan.active,"REVOKED");
      bounds(loan.slot,s.index);
      assert.equal(loan.slot.bytes[s.index],s.expect);
      break;
    }
    case "release":{
      const loan=loans.get(s.loan);requireThat(loan,"UNKNOWN");
      requireThat(loan.active,"REVOKED");
      loan.active=false;loan.slot.loans--;break;
    }
    case "drop":{
      const slot=ref(s.handle,s.as);
      requireThat(slot.loans===0,"BORROWED");
      slot.bytes.fill(0);slot.live=false;
      const t=domain(slot.tenant);t.used-=slot.bytes.length;t.slots.delete(slot);
      break;
    }
    case "retire_actor":{
      const t=domain(s.tenant);
      requireThat(!t.retired,"RETIRED");
      const key=actorKey(s.tenant,s.actor);
      requireThat(!retiredActors.has(key),"RETIRED_ACTOR");
      for(const slot of t.slots){
        if(slot.owner===s.actor&&slot.loans>0)throw error("BORROWED");
      }
      for(const loan of loans.values())
        if(loan.active&&loan.slot.tenant===s.tenant&&loan.reader===s.actor)
          throw error("BORROWED");
      for(const slot of [...t.slots]){
        if(slot.owner!==s.actor)continue;
        slot.bytes.fill(0);slot.live=false;t.used-=slot.bytes.length;t.slots.delete(slot);
      }
      retiredActors.add(key);
      break;
    }
    case "retire":{
      const t=domain(s.tenant);t.retired=true;
      for(const slot of t.slots){slot.bytes.fill(0);slot.live=false;}
      t.slots.clear();t.used=0;break;
    }
    case "copy":{
      const src=ref(s.handle,s.as);
      const dst=reserve(s.toTenant,s.toActor,src.bytes.length);
      dst.bytes.set(src.bytes);
      handles.set(s.out,{slot:dst,generation:dst.generation});
      payloadCopies++;break;
    }
    default:throw error("UNKNOWN_OP");
    }
  }
  for(const s of sample.steps){
    if(s.reject){
      assert.throws(()=>execute(s),(e)=>e?.code===s.reject,
        sample.id+" must reject "+s.op+" with "+s.reject);
    }else execute(s);
  }
  assert.equal(payloadCopies,sample.expectedPayloadCopies,
    sample.id+": explicit copy count mismatch");
  return {payloadCopies,steps:sample.steps.length};
}

test("actor-buffer contract explicitly refuses to claim runtime verification",()=>{
  assert.equal(contract.schema,"actor-buffer-transfer-v1");
  assert.equal(contract.version,1);
  assert.equal(contract.verification,"SOURCE_FREE_ONLY_NOT_GUEST_EVIDENCE");
  assert.deepEqual(Object.keys(contract.backends).sort(),backendNames.slice().sort());
  for(const backend of backendNames)
    assert.equal(contract.backends[backend],"PENDING_REAL_GUEST_EVIDENCE");
  assert.equal(contract.cases.length,11);
  assert.equal(new Set(contract.cases.map(x=>x.id)).size,11);
  assert.equal(contract.limits.perTenantBytes,16);
  assert.equal(contract.limits.perTenantBuffers,2);
});

for(const sample of contract.cases)
  test("source-free actor-buffer oracle: "+sample.id,()=>runCase(sample));

test("oracle must catch incorrect expected data and forged zero-copy evidence",()=>{
  const altered=structuredClone(contract.cases[0]);
  const read=altered.steps.find(x=>x.op==="read"&&x.expect!==undefined);
  read.expect=255;
  assert.throws(()=>runCase(altered),/255/);
  const fake=structuredClone(contract.cases.find(x=>x.id==="explicit-cross-tenant-copy-fallback"));
  fake.expectedPayloadCopies=0;
  assert.throws(()=>runCase(fake),/copy count mismatch/);
});
