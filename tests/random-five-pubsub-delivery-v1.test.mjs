import test from 'node:test';
import assert from 'node:assert/strict';
import {ReferenceDeliveryBroker as Broker} from '../src/random-five-pubsub-delivery-v1.mjs';
test('RELIABLE waits without early ACK or partial fan-out',()=>{
 const b=new Broker({capacity:1});
 const r=b.subscribe('reliable','RELIABLE'),d=b.subscribe('drop','DROP_NEW');
 assert.equal(b.publish('pub',1,'one').status,'ACK');
 assert.equal(b.publish('pub',2,'two').status,'WAIT_BACKPRESSURE');
 assert.equal(b.receive('drop',d.generation).message.payload,'one');
 assert.equal(b.receive('drop',d.generation).status,'EMPTY');
 assert.equal(b.resume('pub').status,'WAIT_BACKPRESSURE');
 assert.equal(b.receive('reliable',r.generation).message.payload,'one');
 assert.equal(b.resume('pub').status,'ACK');
 assert.equal(b.receive('reliable',r.generation).message.payload,'two');
 assert.equal(b.receive('drop',d.generation).message.payload,'two');
});
test('cancellation of backpressure does not issue ACK or consume publisher sequence',()=>{
 const b=new Broker({capacity:1}),s=b.subscribe('s','RELIABLE');
 b.publish('p',1,'one');assert.equal(b.publish('p',2,'two').status,'WAIT_BACKPRESSURE');
 assert.equal(b.cancel('p',2).status,'CANCELLED');
 assert.equal(b.resume('p').status,'REJECTED');
 b.receive('s',s.generation);
 assert.equal(b.publish('p',2,'retry').status,'ACK');
});
test('DROP_NEW keeps first message and counts drop',()=>{
 const b=new Broker({capacity:1}),s=b.subscribe('s','DROP_NEW');
 b.publish('p',1,'first');assert.equal(b.publish('p',2,'second').dropped,1);
 assert.equal(b.receive('s',s.generation).message.payload,'first');
});
test('DROP_OLDEST retains newest message when full',()=>{
 const b=new Broker({capacity:1}),s=b.subscribe('s','DROP_OLDEST');
 b.publish('p',1,'first');assert.equal(b.publish('p',2,'second').dropped,1);
 assert.equal(b.receive('s',s.generation).message.payload,'second');
});
test('LATEST coalesces even before capacity reached',()=>{
 const b=new Broker({capacity:3}),s=b.subscribe('s','LATEST');
 b.publish('p',1,'first');b.publish('p',2,'second');b.publish('p',3,'last');
 assert.equal(b.snapshot().members[0].queued,1);
 assert.equal(b.receive('s',s.generation).message.payload,'last');
});
test('rejoin fencing cancels old pending reliable publication',()=>{
 const b=new Broker({capacity:1}),s=b.subscribe('s','RELIABLE');
 b.publish('p',1,'one');b.publish('p',2,'two');
 b.unsubscribe('s');const replacement=b.subscribe('s','RELIABLE');
 assert.ok(replacement.generation>s.generation);
 assert.equal(b.resume('p').diagnostic,'SUBSCRIPTION_GENERATION_CHANGED');
 assert.equal(b.receive('s',s.generation).diagnostic,'STALE_SUBSCRIPTION');
 assert.equal(b.publish('p',2,'new generation').status,'ACK');
 assert.equal(b.receive('s',replacement.generation).message.payload,'new generation');
});
test('close fences pending publishers and all subscribers',()=>{
 const b=new Broker({capacity:1}),s=b.subscribe('s','RELIABLE');
 b.publish('p',1,'one');b.publish('p',2,'two');
 assert.equal(b.close().cancelled,1);
 assert.equal(b.resume('p').status,'REJECTED');
 assert.equal(b.publish('p',2,'x').diagnostic,'TOPIC_CLOSED');
 assert.equal(b.receive('s',s.generation).diagnostic,'STALE_SUBSCRIPTION');
});
test('per-publisher FIFO sequence prevents replay and skips',()=>{
 const b=new Broker({capacity:3}),s=b.subscribe('s','RELIABLE');
 assert.equal(b.publish('p',2,'skip').diagnostic,'PUBLISHER_SEQUENCE_NOT_MONOTONIC');
 assert.equal(b.publish('p',1,'first').status,'ACK');
 assert.equal(b.publish('p',1,'replay').status,'REJECTED');
 b.publish('q',1,'independent');
 assert.deepEqual([b.receive('s',s.generation).message.payload,b.receive('s',s.generation).message.payload],['first','independent']);
});
test('publisher cannot overrun pending publication',()=>{
 const b=new Broker({capacity:1});b.subscribe('s','RELIABLE');
 b.publish('p',1,'one');b.publish('p',2,'two');
 assert.equal(b.publish('p',3,'third').diagnostic,'PUBLISHER_HAS_PENDING_PUBLICATION');
});
test('enforces bounded, serializable payloads only',()=>{
 const b=new Broker();
 assert.equal(b.publish('p',1,()=>42).diagnostic,'INVALID_PUBLICATION');
 assert.equal(b.publish('p',1,'x'.repeat(2049)).diagnostic,'INVALID_PUBLICATION');
 assert.throws(()=>new Broker({capacity:0}),/INVALID_CAPACITY/);
});
test('source-free model exposes no actor-runtime execution claim',()=>{
 const b=new Broker();assert.equal('runtimeCertified' in b.snapshot(),false);
});
