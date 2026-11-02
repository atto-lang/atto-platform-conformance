import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferTransferTraits, LocalStateThreadModel} from '../src/thread-task-actor-local-v1.mjs';

const primitive = {kind:'primitive',name:'int'};
const str = {kind:'primitive',name:'String'};
const cell = {kind:'cell',of:primitive};
const mutex = {kind:'mutex',of:cell};
const box = t => ({kind:'box',of:t});
const arc = t => ({kind:'arc',of:t});
const entry = argType => ({entryStatic:true,permit:true,argType,resultType:primitive});

test('contract and all phase+diagnostic ids are unique target-only', () => {
  const c=JSON.parse(readFileSync(new URL('../contracts/v1/thread-task-actor-local-v1.json',import.meta.url)));
  assert.equal(c.schema,'oreslang.thread-task-actor-local.contract/1');
  assert.equal(c.status,'TARGET_NOT_IMPLEMENTED');
  assert.deepEqual(c.backends,['java','llvm','net','forge','wasm']);
  assert.equal(c.receipt.zeroStepMeans,'NOT_EXECUTED');
  assert.equal(c.receipt.referenceModelIsGuestEvidence,false);
  assert.equal(c.requireActualOsThread,true);
  assert.equal(c.forbidTaskOrVirtualThreadFallback,true);
  assert.equal(c.cases.length,37);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
  assert.equal(c.cases.filter(x=>x.phase==='compile-pass').length,8);
  assert.equal(c.cases.filter(x=>x.phase==='compile-reject').length,15);
  assert.equal(c.cases.filter(x=>x.phase==='runtime').length,14);
  for (const x of c.cases) {
    assert.ok(x.description && x.id);
    if (x.phase==='compile-reject') assert.match(x.expected_diagnostic,/^E_[A-Z_]+$/);
  }
});

test('owned Box is Send only when its referent is Send', () => {
  assert.deepEqual(inferTransferTraits(box(primitive)),{send:true,sync:true});
  assert.deepEqual(inferTransferTraits(box({kind:'borrow',of:primitive})),{send:false,sync:false});
});

test('Arc refcount is not automatic Sync for interior data', () => {
  assert.deepEqual(inferTransferTraits(cell),{send:true,sync:false});
  assert.deepEqual(inferTransferTraits(arc(cell)),{send:false,sync:false});
  assert.deepEqual(inferTransferTraits(arc({kind:'mutex',of:cell})),{send:true,sync:true});
  assert.deepEqual(inferTransferTraits(mutex),{send:true,sync:true});
});

test('dyn Send witness is distinct from dyn Sync witness', () => {
  assert.deepEqual(inferTransferTraits({kind:'dyn',sendWitness:true}),{send:true,sync:false});
  assert.deepEqual(inferTransferTraits(arc({kind:'dyn',sendWitness:true})),{send:false,sync:false});
  assert.deepEqual(inferTransferTraits(arc({kind:'dyn',sendWitness:true,syncWitness:true})),{send:true,sync:true});
  assert.deepEqual(inferTransferTraits({kind:'dyn',sendWitness:'yes',syncWitness:true}),{send:false,sync:true});
});

test('closures, functions, foreign objects and state containers are not transferable', () => {
  for (const kind of ['closure','function','borrow','ffi','raw','threadState','taskState','actorState','joinHandle','actorRef','rc']) {
    assert.equal(inferTransferTraits({kind}).send,false,kind);
  }
});

test('record fields require full structural Send/Sync, with unknown denied', () => {
  assert.deepEqual(inferTransferTraits({kind:'record',fields:[primitive,str]}),{send:true,sync:true});
  assert.deepEqual(inferTransferTraits({kind:'record',fields:[primitive,cell]}),{send:true,sync:false});
  assert.deepEqual(inferTransferTraits({kind:'record',fields:[primitive,{kind:'mystery'}]}),{send:false,sync:false});
});

test('untrusted getter, cyclic descriptor and deep nesting fail closed', () => {
  const bad={kind:'record',get fields(){throw Error('getter attacked');}};
  assert.equal(inferTransferTraits(bad).send,false);
  const cyc={kind:'box'};cyc.of=cyc;
  assert.equal(inferTransferTraits(cyc).send,false);
  let deep=primitive;for(let i=0;i<40;i++)deep=box(deep);
  assert.equal(inferTransferTraits(deep).send,false);
});

test('spawn demands statically named non-suspending entry, permit, and Send result', () => {
  const m=new LocalStateThreadModel();
  assert.throws(()=>m.spawn(entry({kind:'closure'})),/THREAD_NOT_SEND/);
  assert.throws(()=>m.spawn({...entry(primitive),entryStatic:false}),/THREAD_ENTRY_NOT_STATIC/);
  assert.throws(()=>m.spawn({...entry(primitive),entrySuspends:true}),/THREAD_ENTRY_NOT_STATIC/);
  assert.throws(()=>m.spawn({...entry(primitive),permit:false}),/THREAD_ADMISSION_DENIED/);
  assert.throws(()=>m.spawn({...entry(primitive),resultType:cell,entryStatic:false}),/THREAD_ENTRY_NOT_STATIC/);
  assert.throws(()=>m.spawn({...entry(primitive),resultType:{kind:'ffi'}}),/THREAD_NOT_SEND/);
  assert.throws(()=>new LocalStateThreadModel({capacity:0}),/INVALID_CAPACITY/);
});

test('thread quota bounded and exits require physical completion before join', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const t1=m.spawn(entry(primitive)),t2=m.spawn(entry(primitive));
  assert.throws(()=>m.spawn(entry(primitive)),/THREAD_CAPACITY_EXHAUSTED/);
  m.requestStop(t1);assert.equal(m.stopRequested(t1),true);
  assert.throws(()=>m.join(t1),/THREAD_NOT_PHYSICALLY_EXITED/);
  m.complete(t1,17);assert.equal(m.join(t1),17);
  assert.throws(()=>m.join(t1),/STALE_THREAD_GENERATION/);
  m.complete(t2,19);assert.equal(m.join(t2),19);
});

test('reused slot rejects all stale thread generations and TLS leaks', () => {
  const m=new LocalStateThreadModel({capacity:1});
  const old=m.spawn(entry(primitive));
  m.withExecution(old,{},()=>m.setLocal('thread','tls_value','secret'));
  m.complete(old,1);m.join(old);
  const fresh=m.spawn(entry(primitive));
  assert.equal(old.slot,fresh.slot);assert.notEqual(old.generation,fresh.generation);
  assert.throws(()=>m.withExecution(old,{},()=>{}),/STALE_THREAD_GENERATION/);
  m.withExecution(fresh,{},()=>assert.equal(m.getLocal('thread','tls_value'),undefined));
});

test('TLS is per physical thread and never inherited by a second thread', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const a=m.spawn(entry(primitive)),b=m.spawn(entry(primitive));
  m.withExecution(a,{},()=>m.setLocal('thread','seed',100));
  m.withExecution(b,{},()=>{assert.equal(m.getLocal('thread','seed'),undefined);m.setLocal('thread','seed',200);});
  m.withExecution(a,{},()=>assert.equal(m.getLocal('thread','seed'),100));
  m.withExecution(b,{},()=>assert.equal(m.getLocal('thread','seed'),200));
});

test('TaskLocal follows logical continuation across carrier migration, TLS does not', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const a=m.spawn(entry(primitive)),b=m.spawn(entry(primitive)),task=m.createTask();
  m.withExecution(a,{task},()=>{
    m.setLocal('thread','site','A');
    m.setLocal('task','request_id','r-17');
  });
  m.withExecution(b,{task},()=>{
    assert.equal(m.getLocal('task','request_id'),'r-17');
    assert.equal(m.getLocal('thread','site'),undefined);
  });
  m.retireTask(task);
  assert.throws(()=>m.withExecution(b,{task},()=>{}),/STALE_TASK_GENERATION/);
});

test('ActorLocal survives carrier change but not incarnation restart', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const a=m.spawn(entry(primitive)),b=m.spawn(entry(primitive));
  const actor=m.createActor();
  m.withExecution(a,{actor},()=>m.setLocal('actor','cache',77));
  m.withExecution(b,{actor},()=>assert.equal(m.getLocal('actor','cache'),77));
  const newActor=m.restartActor(actor);
  assert.throws(()=>m.withExecution(b,{actor},()=>{}),/STALE_ACTOR_GENERATION/);
  m.withExecution(b,{actor:newActor},()=>assert.equal(m.getLocal('actor','cache'),undefined));
});

test('actor execution reentrancy is rejected even on a different carrier', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const a=m.spawn(entry(primitive)),b=m.spawn(entry(primitive)),actor=m.createActor();
  m.withExecution(a,{actor},()=>{
    assert.throws(()=>m.withExecution(b,{actor},()=>{}),/LOCAL_CONTEXT_REENTRANCY/);
  });
});

test('Task double activation rejected; cleanup requires quiescence', () => {
  const m=new LocalStateThreadModel(),a=m.spawn(entry(primitive)),task=m.createTask();
  m.withExecution(a,{task},()=>{
    assert.throws(()=>m.withExecution(a,{task},()=>{}),/LOCAL_CONTEXT_REENTRANCY/);
    assert.throws(()=>m.retireTask(task),/TASK_STILL_BOUND/);
  });
  m.retireTask(task);
});

test('actor retirement requires quiescent bound turn', () => {
  const m=new LocalStateThreadModel(),a=m.spawn(entry(primitive)),actor=m.createActor();
  m.withExecution(a,{actor},()=>{
    assert.throws(()=>m.restartActor(actor),/ACTOR_STILL_BOUND/);
    assert.throws(()=>m.retireActor(actor),/ACTOR_STILL_BOUND/);
  });
  m.retireActor(actor);
  assert.throws(()=>m.withExecution(a,{actor},()=>{}),/STALE_ACTOR_GENERATION/);
});

test('unwinding a synchronous reference scope restores carrier binding', () => {
  const m=new LocalStateThreadModel({capacity:2});
  const a=m.spawn(entry(primitive)),b=m.spawn(entry(primitive));
  m.withExecution(a,{},()=>{
    m.setLocal('thread','marker',123);
    assert.throws(()=>m.withExecution(b,{},()=>{throw Error('panic');}),/panic/);
    assert.equal(m.getLocal('thread','marker'),123);
  });
  assert.throws(()=>m.getLocal('thread','marker'),/NO_ACTIVE_THREAD/);
});

test('tenant mismatch prevents actor or Task from borrowing other tenant carriers', () => {
  const m=new LocalStateThreadModel(),a=m.spawn({...entry(primitive),tenant:'A'});
  const foreignTask=m.createTask('B'),foreignActor=m.createActor('B');
  assert.throws(()=>m.withExecution(a,{task:foreignTask},()=>{}),/TENANT_MISMATCH/);
  assert.throws(()=>m.withExecution(a,{actor:foreignActor},()=>{}),/TENANT_MISMATCH/);
});

test('scope keys are explicit identifiers; no ambient state', () => {
  const m=new LocalStateThreadModel(),a=m.spawn(entry(primitive));
  assert.throws(()=>m.getLocal('actor','counter'),/NO_ACTIVE_ACTOR/);
  m.withExecution(a,{},()=>{
    assert.throws(()=>m.setLocal('thread','../other','x'),/INVALID_LOCAL_KEY/);
    assert.throws(()=>m.getLocal('request','trace_id'),/INVALID_LOCAL_KEY/);
  });
});

test('spawn failures leave model capacity free and stop cannot impersonate join', () => {
  const m=new LocalStateThreadModel({capacity:1});
  assert.throws(()=>m.spawn({...entry(arc(cell)),permit:true}),/THREAD_NOT_SEND/);
  const h=m.spawn(entry(box(primitive)));
  m.requestStop(h);
  assert.throws(()=>m.join(h),/THREAD_NOT_PHYSICALLY_EXITED/);
  m.complete(h,3);assert.equal(m.join(h),3);
});
