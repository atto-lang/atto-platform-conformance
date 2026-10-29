import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyActorReference, resolve_persistence_policy } from './policy-modes.mjs';

// Fake storage exercises the host policy adapter, NOT SQLite/native actor durability.
class FakeSidecar {
  constructor(store = new Map()) { this.store=store; this.queue=[]; }
  enqueue(e) {
    this.queue.push({...e, payload:Buffer.from(e.payload)});
    return {status:'admitted', durable:false};
  }
  flush() {
    const results=[];
    for(const e of this.queue.splice(0)) {
      const key=JSON.stringify([e.tenantId,e.actor,e.stateName]);
      const row=this.store.get(key)??{version:0,snapshot:null,events:[]};
      if(e.expectedVersion!==row.version) {
        results.push({opId:e.opId,status:'rejected',durable:false,code:'VERSION_CONFLICT'});
        continue;
      }
      row.version++;
      if(e.kind==='snapshot') row.snapshot={version:row.version,schemaVersion:e.schemaVersion,payload:Buffer.from(e.payload)};
      else row.events.push({version:row.version,schemaVersion:e.schemaVersion,payload:Buffer.from(e.payload)});
      this.store.set(key,row);
      results.push({opId:e.opId,status:'committed',durable:true,version:row.version});
    }
    return results;
  }
  load({tenantId,actor,stateName}) {
    const row=this.store.get(JSON.stringify([tenantId,actor,stateName]));
    return row??{version:0,snapshot:null,events:[]};
  }
}
const args=(sidecar, policy, extra={}) => ({tenantId:'t',actor:'actor-7',epoch:1,
  initialState:{count:0},sidecar,policy,...extra});
const count=(a)=>a.handle_state('critical-read',s=>s.count);

test('exact symbol modes: batching requires snapshot or event underlying',()=>{
  assert.deepEqual(resolve_persistence_policy('#none'),
    {mode:'#none',storageKind:null,batched:false,ack:null});
  assert.equal(resolve_persistence_policy('#snapshot').storageKind,'snapshot');
  assert.equal(resolve_persistence_policy('#event_sourced').storageKind,'event');
  const batch=resolve_persistence_policy({mode:'#batched_sidecar',underlying:'#event_sourced'});
  assert.deepEqual(batch,{mode:'#batched_sidecar',storageKind:'event',batched:true,ack:'#committed'});
  assert.throws(()=>resolve_persistence_policy('#batched_sidecar'),/BATCH_REQUIRES_DURABLE_UNDERLYING/);
  assert.throws(()=>resolve_persistence_policy({mode:'#batched_sidecar',underlying:'#none'}),/BATCH_REQUIRES/);
  assert.throws(()=>resolve_persistence_policy({mode:'#snapshot',ack:'#admitted'}),/INVALID_POLICY/);
  assert.throws(()=>resolve_persistence_policy({mode:'#none',underlying:'#snapshot'}),/INVALID_POLICY/);
  assert.throws(()=>resolve_persistence_policy('#unknown'),/INVALID_POLICY_MODE/);
  assert.throws(()=>resolve_persistence_policy({mode:'#snapshot',extra:'x'}),/INVALID_POLICY/);
});

test('#none is scoped actor-local memory only and restart resets state',()=>{
  const a=new PolicyActorReference(args(null,'#none'));
  a.handle_state('critical-write',s=>{s.count=7;});
  assert.equal(count(a),7);
  assert.throws(()=>a.stage_snapshot('x',()=>{}),/WRONG_STORAGE_KIND/);
  assert.equal(a.version,0);
  a.restore();
  assert.equal(count(a),0);
  assert.throws(()=>a.handle_state('other',s=>s),/INVALID_STATE_ACCESS/);
});

test('sealed reads never give writable alias; async critical scopes fail closed',()=>{
  const a=new PolicyActorReference(args(null,'#none'));
  const leaked=a.handle_state('critical-read',s=>s);
  assert.ok(Object.isFrozen(leaked)===false); // returned copy, not internal state
  leaked.count=88;
  assert.equal(count(a),0);
  assert.throws(()=>a.handle_state('critical-write',async s=>{s.count=99;}),/CRITICAL_CALLBACK_MAY_NOT_SUSPEND/);
  assert.equal(count(a),0);
  assert.throws(()=>a.handle_state('critical-read',async s=>s.count),/CRITICAL_CALLBACK_MAY_NOT_SUSPEND/);
});

test('snapshot is never visible before durable commit; restores on new incarnation',()=>{
  const store=new Map(), io=new FakeSidecar(store);
  const a=new PolicyActorReference(args(io,'#snapshot'));
  assert.equal(a.stage_snapshot('first',s=>{s.count=42;}).durable,false);
  assert.equal(count(a),0);
  assert.equal(a.has_pending_write,true);
  assert.throws(()=>a.handle_state('critical-write',s=>{s.count=4;}),/PERSISTED_WRITE_REQUIRES_COMMIT/);
  assert.throws(()=>a.stage_snapshot('next',s=>{s.count=1;}),/WRITE_ALREADY_PENDING/);
  const [commit]=io.flush();
  a.apply_commit(commit);
  assert.equal(count(a),42);
  assert.equal(a.version,1);
  const restarted=new PolicyActorReference(args(new FakeSidecar(store),'#snapshot'));
  restarted.restore();
  assert.equal(count(restarted),42);
  assert.equal(restarted.version,1);
});

test('event sourced replay rebuilds committed state in journal order',()=>{
  const store=new Map(), io=new FakeSidecar(store);
  const reducer=(state,event)=>({count:state.count+event.increment});
  const config=args(io,'#event_sourced',{reducer});
  const actor=new PolicyActorReference(config);
  assert.equal(actor.stage_event('e1',{increment:2}).durable,false);
  assert.equal(count(actor),0);
  actor.apply_commit(io.flush()[0]);
  actor.stage_event('e2',{increment:5});actor.apply_commit(io.flush()[0]);
  const restarted=new PolicyActorReference(args(new FakeSidecar(store),'#event_sourced',{reducer}));
  restarted.restore();
  assert.equal(count(restarted),7);
  assert.equal(restarted.version,2);
});

test('batched sidecar can co-commit distinct actors without immediate success receipts',()=>{
  const io=new FakeSidecar();
  const policy={mode:'#batched_sidecar',underlying:'#snapshot',ack:'#admitted'};
  const a=new PolicyActorReference(args(io,policy,{actor:'a'}));
  const b=new PolicyActorReference(args(io,policy,{actor:'b'}));
  assert.equal(a.stage_snapshot('a1',s=>{s.count=10;}).status,'admitted');
  assert.equal(b.stage_snapshot('b1',s=>{s.count=20;}).durable,false);
  assert.equal(count(a),0);assert.equal(count(b),0);
  for(const receipt of io.flush()) (receipt.opId==='a1'?a:b).apply_commit(receipt);
  assert.equal(count(a),10);assert.equal(count(b),20);
});

test('rejections cannot mutate state; unknown outcome remains unresolved',()=>{
  const io=new FakeSidecar();
  const a=new PolicyActorReference(args(io,'#snapshot'));
  a.stage_snapshot('x',s=>{s.count=123;});
  assert.throws(()=>a.apply_commit({opId:'x',status:'admitted',durable:false}),/OUTCOME_UNKNOWN/);
  assert.equal(count(a),0);
  assert.throws(()=>a.restore(),/PENDING_OUTCOME_MUST_RESOLVE/);
  assert.throws(()=>a.apply_commit({opId:'other',status:'committed',durable:true,version:1}),/UNMATCHED_RECEIPT/);
  assert.equal(count(a),0);
  a.apply_commit(io.flush()[0]);
  assert.equal(count(a),123);
});

test('serializable state only: reject unsafe values and getters before enqueue',()=>{
  const io=new FakeSidecar();
  const a=new PolicyActorReference(args(io,'#snapshot'));
  assert.throws(()=>a.stage_snapshot('pointer',s=>{s.ptr=Buffer.from('unsafe');}),/NOT_SERIALIZABLE/);
  assert.throws(()=>a.stage_snapshot('fd',s=>{s.fd=undefined;}),/NOT_SERIALIZABLE/);
  assert.throws(()=>a.stage_snapshot('getter',s=>{Object.defineProperty(s,'secret',{get(){return 1;},enumerable:true});}),/NOT_SERIALIZABLE/);
  assert.equal(io.queue.length,0);
  assert.equal(count(a),0);
});

test('schema changes cannot silently reinterpret snapshots',()=>{
  const io=new FakeSidecar(),a=new PolicyActorReference(args(io,'#snapshot'));
  a.stage_snapshot('s1',s=>{s.count=2;});a.apply_commit(io.flush()[0]);
  const v2=new PolicyActorReference(args(io,'#snapshot',{schemaVersion:2}));
  assert.throws(()=>v2.restore(),/SCHEMA_MIGRATION_REQUIRED/);
});
