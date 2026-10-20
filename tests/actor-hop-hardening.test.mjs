import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActorHopTrace, appendActorHop, snapshotActorHops,
  convertActorHopLayout, ActorTraceComponentIndex,
} from '../lib/actor-hop-trace.mjs';

const layouts = ['aos', 'soa', 'aosoa'];
const hop = i => ({actor: 'Actor'+i, handler:'handle', kind:'receive',
  source:{unit:'src/actor.ores', line:i+1, column:2}});

test('trace context identity cannot be forged by cloning or copying its shape', () => {
  const original = appendActorHop(createActorHopTrace(), hop(0));
  const forged = Object.freeze({...original});
  assert.throws(() => appendActorHop(forged, hop(1)), TypeError);
  assert.throws(() => snapshotActorHops(forged), TypeError);
  assert.throws(() => convertActorHopLayout(forged, 'soa'), TypeError);
  assert.equal(Reflect.ownKeys(original).some(x=>typeof x==='symbol'),false);
});

test('ECS handles are opaque local capabilities, not guessed generation numbers', () => {
  const a = new ActorTraceComponentIndex(1);
  const b = new ActorTraceComponentIndex(1);
  const trace = createActorHopTrace();
  const original = a.attach(trace);
  assert.strictEqual(a.resolve(original), trace);
  assert.equal(a.resolve({...original}), null);
  assert.equal(a.resolve({slot:original.slot,generation:original.generation}), null);
  assert.equal(b.resolve(original), null);
  assert.equal(a.release({...original}), false);
  assert.equal(a.release(original), true);
  const next = a.attach(trace);
  assert.equal(next.slot, original.slot);
  assert.notEqual(next.generation, original.generation);
  assert.equal(a.resolve(original), null);
});

test('AoSoA uses blocked columns, not arrays of AoS records', () => {
  let t = createActorHopTrace({layout:'aosoa',capacity:16,blockSize:3});
  for(let i=0;i<10;i++) t = appendActorHop(t, hop(i));
  assert.equal(t.storage.length,6);
  assert.deepEqual(t.storage[0].actor, ['Actor0','Actor1','Actor2']);
  assert.deepEqual(t.storage[1].actor, ['Actor3','Actor4','Actor5']);
  assert.equal(t.storage[5].actor.length,1);
  assert.equal(Array.isArray(t.storage[0]),false);
  assert(Object.isFrozen(t.storage[0].actor));
});

test('reject hidden getters, unsupported trace options and unsafe source identity', () => {
  const t = createActorHopTrace();
  const accessor = Object.defineProperty({...hop(0)},'actor',{
    enumerable:true,get(){throw new Error('getter executed');}
  });
  assert.throws(()=>appendActorHop(t,accessor), TypeError);
  assert.throws(()=>createActorHopTrace({untrusted:true}), TypeError);
  assert.throws(()=>createActorHopTrace(null), TypeError);
  for(const unit of ['../secret.ores','/private/file','https://example/x?token=abc',
    'src//foo','src/../foo','src\\secret.ores','src/foo#query']) {
    assert.throws(()=>appendActorHop(t,{...hop(0),source:{unit,line:1,column:1}}),TypeError);
  }
});

test('all layouts preserve newest 5 and same snapshots at nondivisible block boundaries', () => {
  for(const capacity of [5,6,7,15,16,17,64]){
    for(const size of [1,2,3,4,7,64]){
      let source=createActorHopTrace({layout:'aos',capacity});
      for(let i=0;i<100;i++) source=appendActorHop(source,hop(i));
      const expected=snapshotActorHops(source);
      for(const layout of layouts){
        const converted=convertActorHopLayout(source,layout,size);
        assert.deepEqual(snapshotActorHops(converted),expected);
        assert.deepEqual(expected.entries.slice(-5).map(x=>x.actor),
          ['Actor95','Actor96','Actor97','Actor98','Actor99']);
      }
    }
  }
});

test('redaction removes actor, handler, source and generation data but retains visit',()=>{
  const t=appendActorHop(createActorHopTrace(),{
    actor:'PrivateActor',handler:'secret',kind:'rpc-receive',
    generation:'private',source:{unit:'src/private.ores',line:1,column:1},redacted:true
  });
  const hop=snapshotActorHops(t).entries[0];
  assert.equal(hop.actor,'<redacted>');
  assert.equal(hop.handler,'<redacted>');
  assert.equal(hop.source,null);
  assert.equal(hop.generation,null);
  assert.equal(hop.kind,'rpc-receive');
});

test('high-volume actor admission remains bounded with protected newest five',()=>{
  for(const layout of layouts){
    let t=createActorHopTrace({layout});
    for(let i=0;i<100000;i++)
      t=appendActorHop(t,{actor:'A'+(i%7),handler:'receive',kind:'forward'});
    const s=snapshotActorHops(t);
    assert.equal(s.total_visits,100000);
    assert.equal(s.retained,16);
    assert.equal(s.omitted_prior,99984);
    assert.deepEqual(s.entries.slice(-5).map(x=>x.actor),
      Array.from({length:5},(_,i)=>'A'+((99995+i)%7)));
  }
});
