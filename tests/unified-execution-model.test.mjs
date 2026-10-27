import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UnifiedExecutionModel as Model} from '../src/unified-execution-model.mjs';
const cpu = cost => ({kind:'cpu',cost});
const done = () => ({kind:'done'});
const io = token => ({kind:'io',token});
const tick = m => { const x=m.dispatch(); if (x) m.release(); return x; };

test('CPU hog is cooperatively preempted, and peer runs before it finishes', () => {
  const m = new Model({reductionBudget:3});
  m.submit({id:'hog',steps:[cpu(10),done()]});
  m.submit({id:'peer',steps:[cpu(1),done()]});
  assert.equal(tick(m).id,'hog');
  assert.equal(tick(m).id,'peer');
  assert.equal(m.inspect('peer').physicallyRetired,true);
  while (!m.inspect('hog').physicallyRetired) tick(m);
  assert.equal(m.inspect('hog').dispatches,4);
});

test('pending I/O suspends without retaining a physical execution carrier', () => {
  const m = new Model();
  m.submit({id:'a',steps:[io('socket-1'),done()]});
  assert.equal(tick(m).next,'suspended');
  assert.equal(m.active,null);
  assert.equal(m.inspect('a').physicallyRetired,false);
  m.submit({id:'b',steps:[cpu(1),done()]});
  assert.equal(tick(m).id,'b');
  assert.equal(m.wake({id:'a',generation:1,token:'socket-1'}),true);
  assert.equal(tick(m).id,'a');
  assert.equal(m.inspect('a').physicallyRetired,true);
});

test('early completion and repeated/stale I/O wake cannot execute inline or replay', () => {
  const m = new Model();
  m.submit({id:'a',generation:2,steps:[io('fd'),cpu(2),done()]});
  m.dispatch();
  assert.equal(m.wake({id:'a',generation:2,token:'fd'}),true);
  assert.throws(()=>m.dispatch(),/carrier/);
  assert.equal(m.wake({id:'a',generation:2,token:'fd'}),false);
  m.release();
  assert.equal(m.inspect('a').state,'queued');
  assert.equal(m.wake({id:'a',generation:1,token:'fd'}),false);
  assert.equal(m.wake({id:'a',generation:2,token:'fd'}),false);
  assert.deepEqual(m.events.slice(0,3),['enter:a','wake:a','exit:a']);
  assert.equal(tick(m).id,'a');
  assert.equal(m.inspect('a').wakes,1);
});

test('cancellation request is not physical retirement; cleanup needs new dispatch', () => {
  const m = new Model({queueCapacity:1,controlCapacity:1});
  m.submit({id:'a',steps:[io('io'),done()]});
  tick(m);
  m.submit({id:'busy',steps:[cpu(10),done()]});
  assert.equal(m.cancel('a'),true);
  assert.equal(m.inspect('a').physicallyRetired,false);
  assert.equal(m.wake({id:'a',generation:1,token:'io'}),false);
  assert.equal(m.dispatch().id,'a'); // Reserved CONTROL progress despite DATA saturation
  assert.equal(m.inspect('a').physicallyRetired,false);
  m.release();
  assert.deepEqual(m.inspect('a'),{state:'terminal',terminal:'cancelled',physicallyRetired:true,
    dispatches:2,wakes:0,cancelRequested:true});
});

test('cancel during running dispatch cannot release active actor lifetime', () => {
  const m=new Model();
  m.submit({id:'a',actor:'x',steps:[cpu(50),done()]});
  m.dispatch();
  assert.equal(m.cancel('a'),true);
  assert.equal(m.inspect('a').physicallyRetired,false);
  assert.equal(m.actorActive.has('x:1'),true);
  m.release();
  assert.equal(m.inspect('a').physicallyRetired,true);
  assert.equal(m.actorActive.size,0);
});

test('bounded admission and immutable capture transfer gate', () => {
  const m=new Model({queueCapacity:1});
  assert.throws(()=>m.submit({id:'bad',captures:['mut_borrow'],steps:[done()]}),/borrow/);
  assert.throws(()=>m.submit({id:'bad',captures:['actor_state'],steps:[done()]}),/borrow/);
  assert.equal(m.submit({id:'a',captures:['take','share'],steps:[done()]}),true);
  assert.equal(m.submit({id:'b',steps:[done()]}),false);
  assert.equal(m.inspect('b'),null);
  assert.throws(()=>m.submit({id:'a',steps:[done()]}),/duplicate/);
});

test('source-free oracle bounded by strict budgets and no duplicate admissions', () => {
  let seed=2701;
  const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0));
  const m=new Model({reductionBudget:5,queueCapacity:128});
  for(let i=0;i<100;i++) m.submit({id:`t${i}`,steps:[cpu(rnd()%80+1),done()]});
  let dispatchCount=0;
  while(m.ready.length || m.control.length) {
    tick(m); dispatchCount++;
    assert.ok(dispatchCount<5000,'possible starvation or loop');
  }
  assert.equal([...m.tasks.values()].filter(x=>x.physicallyRetired).length,100);
  assert.equal(m.active,null);
  assert.equal(m.actorActive.size,0);
});

test('unsupported operations, invalid budgets and unknown owners fail closed',()=>{
  for(const opts of [{reductionBudget:0},{queueCapacity:0},{controlCapacity:-1}])
    assert.throws(()=>new Model(opts),RangeError);
  const m=new Model();
  assert.throws(()=>m.submit({id:'x',steps:[{kind:'ffi-block'}]}),/unsupported/);
  assert.equal(m.inspect('x'),null);
  assert.equal(m.wake({id:'unknown',generation:1,token:'fd'}),false);
  assert.equal(m.cancel('unknown'),false);
});

test('manifest cannot treat source-free model as five-backend guest execution',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../contracts/v1/unified-execution-cases.v1.json',import.meta.url),'utf8'));
  assert.equal(manifest.schema,'oreslang.unified-execution-cases/1');
  assert.equal(manifest.kind,'source-free-reference-only');
  assert.equal(manifest.guestExecutionVerified,false);
  assert.deepEqual(Object.keys(manifest.backends).sort(),['forge','java','llvm','net','wasm']);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,manifest.cases.length);
  for (const id of ['transitive-sync-helper-loop','native-scalar-multipeer-aot']) {
    const candidate = manifest.cases.find(x=>x.id===id);
    assert.ok(candidate, `missing source-level verification gate: ${id}`);
    assert.equal(candidate.guestVerified,false);
    assert.ok(candidate.requirements.length>=5);
  }
  for(const v of Object.values(manifest.backends)) assert.equal(v.verified,false);
  for(const c of manifest.cases) {
    assert.equal(c.guestVerified,false);
    assert.ok(c.requirements.length>0);
  }
});

test('resumable CPU slice reserves a ready ticket against late admission',()=>{
  const m=new Model({queueCapacity:1,reductionBudget:2});
  assert.equal(m.submit({id:'a',steps:[cpu(5),done()]}),true);
  assert.equal(m.dispatch().next,'queued');
  assert.equal(m.submit({id:'b',steps:[done()]}),false);
  m.release();
  assert.equal(m.ready.length,1);
  while(!m.inspect('a').physicallyRetired) tick(m);
  assert.equal(m.submit({id:'b',steps:[done()]}),true);
});

test('wake during registration reserves ready credit even at capacity one',()=>{
  const m=new Model({queueCapacity:1});
  m.submit({id:'a',steps:[io('fd'),done()]});
  m.dispatch();
  assert.equal(m.submit({id:'b',steps:[done()]}),false);
  assert.equal(m.wake({id:'a',generation:1,token:'fd'}),true);
  m.release();
  assert.equal(m.ready.length,1);
  assert.equal(tick(m).id,'a');
  assert.equal(m.inspect('a').physicallyRetired,true);
});

test('preempted synchronous actor turn cannot be overtaken by younger USER mail while peers progress', () => {
  const m = new Model({queueCapacity:5,reductionBudget:2});
  assert.equal(m.submit({id:'older',actor:'A',generation:7,
    steps:[cpu(5),done()]}),true);
  assert.equal(m.submit({id:'younger',actor:'A',generation:7,
    steps:[cpu(1),done()]}),true);
  assert.equal(m.submit({id:'peer',actor:'B',generation:1,
    steps:[cpu(1),done()]}),true);

  const order = [];
  while (m.ready.length) {
    const dispatched = tick(m);
    order.push(dispatched.id);
    assert.ok(order.length < 12, 'bounded queue must eventually drain');
  }
  assert.deepEqual(order, ['older','peer','older','older','older','younger']);
  for (const id of ['older','younger','peer'])
    assert.equal(m.inspect(id).physicallyRetired,true);
  assert.equal(m.actorActive.size,0);
});

test('cancelled older actor turn frees the lane for its younger queued turn', () => {
  const m = new Model({queueCapacity:3,reductionBudget:2});
  m.submit({id:'older',actor:'A',steps:[cpu(20),done()]});
  m.submit({id:'younger',actor:'A',steps:[done()]});
  m.dispatch();
  assert.equal(m.cancel('older'),true);
  assert.equal(m.inspect('older').physicallyRetired,false);
  m.release();
  assert.equal(m.inspect('older').physicallyRetired,true);
  assert.equal(tick(m).id,'younger');
  assert.equal(m.inspect('younger').physicallyRetired,true);
});
