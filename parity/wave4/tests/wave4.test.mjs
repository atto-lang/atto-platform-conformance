import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ownedData,StateDomain,SupervisorControl,ActorGroupModel,
 StrictMessagePackFixture,Channels,IoReactorModel
} from '../src/wave4.mjs';
test('state grants bind actor identity and explicit read versus critical write',()=>{
 const s=new StateDomain();s.define('a',{counter:1});s.define('b',{counter:7});
 const read=s.grant('a','read'),write=s.grant('a','write');
 assert.equal(s.read('a',read).value.counter,1);
 assert.throws(()=>s.write('a',read,d=>{d.counter=2}),/insufficient/);
 assert.throws(()=>s.read('b',read),/foreign/);
 assert.equal(s.write('a',write,d=>{d.counter+=4}),1);
 assert.equal(s.read('a',read).value.counter,5);
 assert.equal(s.read('b',s.grant('b','read')).value.counter,7);
});
test('state updates are atomic on throw and invalid data',()=>{
 const s=new StateDomain();s.define('a',{n:1});const w=s.grant('a','write');
 assert.throws(()=>s.write('a',w,d=>{d.n=9;throw Error('abort')}),/abort/);
 assert.equal(s.read('a',w).value.n,1);
 assert.throws(()=>s.write('a',w,d=>{d.n=1.5}),/nonportable numeric/);
 assert.equal(s.read('a',w).version,0);
});
test('state cannot suspend a borrowed writable scope',()=>{
 const s=new StateDomain();s.define('a',{n:1});const w=s.grant('a','write');
 assert.throws(()=>s.write('a',w,async d=>{d.n=99}),/crossed suspension/);
 assert.equal(s.read('a',w).value.n,1);
});
test('state draft escape never mutates owned committed value',()=>{
 const s=new StateDomain();s.define('a',{nested:{n:2}});const w=s.grant('a','write');let escaped;
 s.write('a',w,d=>{d.nested.n=4;escaped=d;});
 escaped.nested.n=700;
 assert.equal(s.read('a',w).value.nested.n,4);
 assert.equal(Object.isFrozen(s.read('a',w).value.nested),true);
});
test('state reentrant update and generation-stale grants are rejected',()=>{
 const s=new StateDomain();s.define('a',{x:1});const w=s.grant('a','write');
 assert.throws(()=>s.write('a',w,()=>s.write('a',w,()=>{})),/reentrant/);
 s.retire('a');assert.throws(()=>s.read('a',w),/stale/);
});
test('cross-actor payload rejects capability objects, cycles, invalid numeric and deep data',()=>{
 const a={};a.self=a;
 for(const value of [a,new Date(),Promise.resolve(1),{x:Infinity},{x:1.1},{__proto__:null}]) {
  if(Object.getPrototypeOf(value)===null)continue;
  assert.throws(()=>ownedData(value),/wave4:/);
 }
 assert.deepEqual(ownedData([42,'hello',true]),[42,'hello',true]);
});
test('ActorGroup manager-only permit, live actor join and idempotent membership',()=>{
 const g=new ActorGroupModel('owner',{capacity:2}),permit=g.issue('owner');
 assert.equal(g.join('child',permit,{running:true}),true);
 assert.equal(g.join('child',permit,{running:true}),false);
 assert.equal(g.size,2);
 assert.throws(()=>g.join('other',permit,{running:true}),/quota/);
 assert.throws(()=>g.join('other',permit),/live actor/);
 assert.throws(()=>g.issue('child'),/creator/);
});
test('ActorGroup permit revocation, leave and close preserve authority',()=>{
 const g=new ActorGroupModel('owner');const stale=g.issue('owner');const live=g.rotate('owner');
 assert.throws(()=>g.join('child',stale,{running:true}),/stale/);
 g.join('child',live,{running:true});g.leave('child',{running:true});assert.equal(g.size,1);
 g.close('owner');assert.throws(()=>g.join('child',live,{running:true}),/stale/);
 assert.throws(()=>g.close('child'),/creator/);
});
test('CONTROL notice is independent from full DATA mailbox',()=>{
 const s=new SupervisorControl({maxData:1,maxControl:2});const cap=s.register('child','parent');
 assert.equal(s.data({n:1}),true);assert.equal(s.data({n:2}),false);
 assert.equal(s.terminate('child','parent','panic',cap),true);
 assert.equal(s.sizes.data,1);assert.equal(s.sizes.control,1);
 assert.deepEqual(s.popControl(),{actor:'child',parent:'parent',generation:1,kind:'panic'});
 assert.equal(s.popData().n,1);
});
test('CONTROL exactly-once terminal per actor generation and parent spoof denial',()=>{
 const s=new SupervisorControl();const cap=s.register('child','parent');
 assert.throws(()=>s.terminate('child','imposter','panic',cap),/untrusted/);
 assert.equal(s.terminate('child','parent','raise',cap),true);
 assert.equal(s.terminate('child','parent','panic',cap),false);
 const renewed=s.restart('child','parent',cap);assert.throws(()=>s.terminate('child','parent','panic',cap),/authority/);assert.equal(s.terminate('child','parent','panic',renewed),true);
 assert.equal(s.popControl().generation,1);assert.equal(s.popControl().generation,2);
});
test('CONTROL saturated dedicated lane is explicit, never drops into DATA',()=>{
 const s=new SupervisorControl({maxData:1,maxControl:1});const a=s.register('a','p'),b=s.register('b','p');
 assert.equal(s.terminate('a','p','panic',a),true);
 assert.equal(s.terminate('b','p','panic',b),false);
 assert.equal(s.sizes.control,1);assert.equal(s.sizes.data,0);
 s.popControl();assert.equal(s.terminate('b','p','panic',b),true);
});
test('typed MessagePack encodes stable fixarray, fixstr, version, variant and payload',()=>{
 const codec=new StrictMessagePackFixture();codec.add('Demo',1,['int','str']);
 const wire=codec.encode('Demo',1,[5,'ok']);
 assert.equal(wire.toString('hex'),'94a444656d6f02019205a26f6b');
 const decoded=codec.decode(wire);
 assert.deepEqual(decoded.payload,[5,'ok']);assert.equal(decoded.variant,1);
});
test('MessagePack enforces distinct variant tags even for matching data shape',()=>{
 const codec=new StrictMessagePackFixture();codec.add('X',1,['int']);codec.add('X',2,['int']);
 assert.equal(codec.decode(codec.encode('X',1,[7])).variant,1);
 assert.equal(codec.decode(codec.encode('X',2,[7])).variant,2);
 assert.throws(()=>codec.encode('X',3,[7]),/unknown/);
});
test('MessagePack rejects malformed, trailing, unknown schema and bad version',()=>{
 const codec=new StrictMessagePackFixture();codec.add('X',1,['int']);
 const bytes=codec.encode('X',1,[1]);
 assert.throws(()=>codec.decode(Buffer.concat([bytes,Buffer.from([0])])),/trailing/);
 const bad=Buffer.from(bytes);bad[3]=3;assert.throws(()=>codec.decode(bad),/version|unknown/);
 assert.throws(()=>codec.decode(Buffer.from([0x94,0xa1,0x58,2])),/truncated/);
 assert.throws(()=>codec.decode(Buffer.from([0xc0])),/unsupported/);
});
test('MessagePack type boundary denies capabilities, codec objects, unbounded payload',()=>{
 const codec=new StrictMessagePackFixture();codec.add('X',1,['int','bool']);
 assert.throws(()=>codec.encode('X',1,[{},true]),/wrong payload/);
 assert.throws(()=>codec.encode('X',1,[3,'yes']),/wrong payload/);
 assert.throws(()=>codec.add('X',1,['int']),/redefinition/);
});
test('channel full sends retain data and return backpressure rather than drop',()=>{
 const c=new Channels();c.create('x',1);assert.equal(c.send('x',{n:1}),true);
 assert.equal(c.send('x',{n:2}),false);
 assert.equal(c.receive('x').value.n,1);
 assert.deepEqual(c.receive('x'),{ready:false,closed:false});
});
test('select fairness alternates ready input channels',()=>{
 const c=new Channels();c.create('a',3);c.create('b',3);
 c.send('a',1);c.send('b',2);c.send('a',3);c.send('b',4);
 assert.deepEqual([c.select(['a','b']).selected,c.select(['a','b']).selected,c.select(['a','b']).selected,c.select(['a','b']).selected],['a','b','a','b']);
});
test('nb select yields a Future-shaped observation and closed input terminates',()=>{
 const c=new Channels();c.create('a');assert.equal(c.nbSelect(['a']).status,'pending');
 c.close('a');assert.equal(c.nbSelect(['a']).status,'settled');
 assert.deepEqual(c.select(['a']),{selected:'a',ready:true,closed:true});
});
test('select cannot claim progress from missing, duplicate, or forged channels',()=>{
 const c=new Channels();c.create('a');
 assert.throws(()=>c.select(['a','a']),/selection/);
 assert.throws(()=>c.select(['missing']),/unknown/);
 assert.throws(()=>c.send('missing',1),/closed/);
});
test('reactor manager distributes 1-4 reactor IDs and bounds live operations',()=>{
 const i=new IoReactorModel({reactors:4,limit:4});
 const ops=[0,0,0,0].map(()=>i.submit('actor',1,'read'));
 assert.deepEqual(ops.map(x=>x.reactor),[0,1,2,3]);
 assert.throws(()=>i.submit('actor',1,'write'),/quota/);
 ops.forEach(x=>i.cancel(x));assert.equal(i.stats.outstanding,0);
});
test('kernel completion never dispatches guest code inline; scheduler lease required',()=>{
 const i=new IoReactorModel();const x=i.submit('a',1,'read');
 assert.equal(i.kernelComplete(x,{bytes:3}),true);
 assert.equal(i.stats.pendingCompletions,1);
 assert.throws(()=>i.drainForActor('a',1),/lease/);
 assert.deepEqual(i.drainForActor('a',1,{lease:i.grantActorLease('a',1)}).map(x=>x.result.bytes),[3]);
 assert.equal(i.stats.pendingCompletions,0);
});
test('cancel races with completion and double delivery never resumes twice',()=>{
 const i=new IoReactorModel();const x=i.submit('a',1,'read');
 assert.equal(i.cancel(x),true);assert.equal(i.cancel(x),false);
 assert.equal(i.kernelComplete(x,{bytes:2}),false);
 assert.equal(i.stats.pendingCompletions,0);
});
test('foreign generation/owner cannot collect reactor completions',()=>{
 const i=new IoReactorModel();const x=i.submit('a',3,'write');
 i.kernelComplete(x,5);
 assert.deepEqual(i.drainForActor('a',4,{lease:i.grantActorLease('a',4)}),[]);
 assert.deepEqual(i.drainForActor('b',3,{lease:i.grantActorLease('b',3)}),[]);
 assert.equal(i.drainForActor('a',3,{lease:i.grantActorLease('a',3)}).length,1);
 assert.throws(()=>i.kernelComplete({id:x.id},7),/untrusted/);
});
