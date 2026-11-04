import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-free reference oracle, NOT guest execution or backend parity evidence.
const contract = JSON.parse(readFileSync(new URL('../contracts/scoped-locals-v1.json', import.meta.url)));
const kinds = ['actor','thread','request','task'];

class ReferenceRuntime {
  #issued = new WeakSet();
  #keys = new WeakSet();
  key(scope,type) {
    // This reference model supports only immutable scalar snapshots.
    // Accepting key.type='object' would preserve mutable JS aliases and
    // incorrectly classify host pointers/capabilities as safe guest locals.
    if (!kinds.includes(scope) || !['number','string','boolean'].includes(type))
      throw new TypeError('unsupported scoped-local value type');
    const key=Object.freeze({scope,type}); this.#keys.add(key); return key;
  }
  admit(scope,identity,{slots=32,bytes=8192}={}) {
    if (!kinds.includes(scope) || !identity || !identity.runtime ||
        !identity.tenant || !identity.isolate || !identity.owner || !identity.generation ||
        !Number.isSafeInteger(slots) || slots<1 || !Number.isSafeInteger(bytes) || bytes<1)
      throw new TypeError('invalid identity or budget');
    const ticket=Object.freeze({scope,identity:Object.freeze({...identity})});
    this.#issued.add(ticket);
    return {ticket,open:true,cells:new Map(),slots,bytes,used:0};
  }
  #valid(store,key,caller) {
    return store.open && this.#keys.has(key) && this.#issued.has(caller) &&
      store.ticket===caller && caller.scope===key.scope;
  }
  set(store,key,caller,value) {
    if(!this.#valid(store,key,caller) || typeof value!==key.type) return false;
    const size=typeof value==='string'?Buffer.byteLength(value,'utf8'):8;
    const old=store.cells.get(key)?.size??0;
    if((!store.cells.has(key)&&store.cells.size===store.slots) ||
        size>store.bytes-(store.used-old)) return false;
    store.cells.set(key,{value,size}); store.used+=size-old;return true;
  }
  get(store,key,caller) {
    return this.#valid(store,key,caller)?store.cells.get(key)?.value:undefined;
  }
  close(store) {
    if(!store.open)return false;
    store.open=false;store.cells.clear();store.used=0;return true;
  }
}
const id=(owner,generation=1)=>({runtime:'R',tenant:'T',isolate:'I',owner,generation});

test('candidate schema covers four scopes, all five backends and denies synthetic promotion',()=>{
  assert.equal(contract.status,'candidate-unattested');
  assert.deepEqual(contract.backendTargets,['java','llvm','wasm','forge','net']);
  assert.deepEqual(Object.keys(contract.scopes),kinds);
  const ids=contract.scenarios.map(s=>s.id);
  assert.equal(ids.length,new Set(ids).size);
  for(const scope of [...kinds,'all']) assert.ok(contract.scenarios.some(s=>s.scope===scope));
  assert.equal(contract.promotion.hostUnitTestsAloneSufficient,false);
  assert.equal(contract.promotion.syntaxRejectionCountsAsParityPass,false);
  assert.equal(contract.promotion.guestSourceExecutionRequired,true);
});

test('actor state persists across turns, not incarnations or tenants',()=>{
  const r=new ReferenceRuntime(),k=r.key('actor','number');
  const a=r.admit('actor',id('actor-5'));
  const restarted=r.admit('actor',id('actor-5',2));
  const foreign=r.admit('actor',{...id('actor-5'),tenant:'other'});
  assert.ok(r.set(a,k,a.ticket,17));
  assert.equal(r.get(a,k,a.ticket),17);
  assert.equal(r.get(restarted,k,restarted.ticket),undefined);
  assert.equal(r.get(foreign,k,foreign.ticket),undefined);
  assert.equal(r.get(a,k,restarted.ticket),undefined);
  assert.equal(r.close(a),true);
  assert.equal(r.close(a),false);
  assert.equal(r.get(a,k,a.ticket),undefined);
});

test('overlapping requests on one actor have independent request locals',()=>{
  const r=new ReferenceRuntime(),k=r.key('request','string');
  const a=r.admit('request',id('actor-5/mail-A'));
  const b=r.admit('request',id('actor-5/mail-B'));
  assert.ok(r.set(a,k,a.ticket,'A'));
  assert.ok(r.set(b,k,b.ticket,'B'));
  assert.equal(r.get(a,k,b.ticket),undefined);
  assert.equal(r.get(a,k,a.ticket),'A');
  assert.equal(r.get(b,k,b.ticket),'B');
  r.close(a);assert.equal(r.get(b,k,b.ticket),'B');
});

test('logical TaskLocal does not implicitly inherit; explicit copy is independent',()=>{
  const r=new ReferenceRuntime(),k=r.key('task','string');
  const parent=r.admit('task',id('task-1')),child=r.admit('task',id('task-2'));
  assert.ok(r.set(parent,k,parent.ticket,'initial'));
  assert.equal(r.get(child,k,child.ticket),undefined);
  assert.ok(r.set(child,k,child.ticket,r.get(parent,k,parent.ticket)));
  r.set(parent,k,parent.ticket,'changed');r.close(parent);
  assert.equal(r.get(child,k,child.ticket),'initial');
});

test('physical ThreadLocal follows carrier, not logical task or actor',()=>{
  const r=new ReferenceRuntime(),k=r.key('thread','number');
  const a=r.admit('thread',id('pthread-1')),b=r.admit('thread',id('pthread-2'));
  assert.ok(r.set(a,k,a.ticket,2));
  assert.equal(r.get(b,k,b.ticket),undefined);
  assert.equal(r.get(a,k,a.ticket),2); // carrier reuse exposes previous TLS
  assert.equal(r.get(a,k,b.ticket),undefined);
});

test('cross-scope keys, fabricated tickets, wrong types and retirement fail closed',()=>{
  const r=new ReferenceRuntime(),k=r.key('task','string');
  const task=r.admit('task',id('task-1')),actor=r.admit('actor',id('actor'));
  assert.equal(r.set(actor,k,actor.ticket,'x'),false);
  assert.equal(r.set(task,k,{...task.ticket},'x'),false);
  assert.equal(r.set(task,{scope:'task',type:'string'},task.ticket,'x'),false);
  assert.equal(r.set(task,k,task.ticket,3),false);
  assert.ok(r.set(task,k,task.ticket,'ok'));
  r.close(task);assert.equal(r.set(task,k,task.ticket,'stale'),false);
});

test('mutable host objects and foreign aliases cannot become scoped-local snapshots',()=>{
  const r=new ReferenceRuntime();
  for(const scope of kinds) {
    assert.throws(()=>r.key(scope,'object'),TypeError);
    assert.throws(()=>r.key(scope,'function'),TypeError);
    const scalar=r.key(scope,'string'),s=r.admit(scope,id(scope+'-owner'));
    assert.equal(r.set(s,scalar,s.ticket,{capability:true}),false);
    assert.equal(r.get(s,scalar,s.ticket),undefined);
    assert.ok(r.set(s,scalar,s.ticket,'immutable snapshot'));
  }
});

test('slot and UTF-8 byte exhaustion preserve previous values',()=>{
  const r=new ReferenceRuntime(),a=r.key('request','string'),b=r.key('request','string');
  const scope=r.admit('request',id('request'),{slots:1,bytes:6});
  assert.ok(r.set(scope,a,scope.ticket,'12345'));
  assert.equal(r.set(scope,b,scope.ticket,'x'),false);
  assert.equal(r.set(scope,a,scope.ticket,'1234567'),false);
  assert.equal(r.get(scope,a,scope.ticket),'12345');
  assert.ok(r.set(scope,a,scope.ticket,'ééé'));
  assert.equal(r.get(scope,a,scope.ticket),'ééé');
});

test('repeated interleaving never reveals another request value',()=>{
  const r=new ReferenceRuntime(),k=r.key('request','number');
  const all=Array.from({length:64},(_,i)=>r.admit('request',id('request-'+(i+1))));
  for(let i=0;i<800;i++){
    const n=(i*37)%all.length;
    if(i%19===0)r.close(all[n]);
    else r.set(all[n],k,all[n].ticket,n);
    for(let j=0;j<all.length;j++)
      if(j!==n)assert.equal(r.get(all[j],k,all[n].ticket),undefined);
  }
});
