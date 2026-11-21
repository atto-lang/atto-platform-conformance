import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ActorReadyPipeOracle } from '../src/actor-ready-pipe-oracle-v1.mjs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const data=JSON.parse(read('contracts/actor-ready-pipe-lifecycle-v1.json'));
const sha = s => { const b=Buffer.from(s); return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'); };
const pair = () => { const v=new ActorReadyPipeOracle(); const p=v.spawn({emits:'int'}); const c=v.spawn({receives:'int'}); return {v,p,c}; };
test('versioned source fixtures cannot masquerade as backend guest proof',() => {
 assert.equal(data.schema_version,1); assert.equal(data.status,'SOURCE_ONLY_NOT_EXECUTED');
 assert.equal(data.no_claim_of_cross_backend_parity,true);
 assert.equal(data.cases.length,7);
 assert.equal(data.backend_evidence.length,11);
 for(const b of data.backend_evidence) { assert.equal(b.guest_result,'NOT_EXECUTED'); assert.equal(b.artifact_identity,null); assert.equal(b.runner_receipt,null); }
 for(const f of data.cases) {
  assert.match(f.source_git_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(sha(read(f.path)),f.source_git_blob_sha,f.id);
  assert.equal(f.evidence,'NOT_EXECUTED');
 }
 const byId = Object.fromEntries(data.cases.map(c=>[c.id,read(c.path)]));
 assert.doesNotMatch(byId['connect-before-ready'],/await\s+(?:producer|consumer)\.get_ready\(/);
 assert.match(byId['explicit-get-ready'],/await producer\.get_ready\(\)/);
 assert.match(byId['await-spawn'],/await spawn Producer\(\)/);
 assert.match(byId['property-ready-reject'],/await producer\.ready;/);
 assert.match(byId['property-done-reject'],/await actor\.done;/);
 assert.match(byId['duplicate-direction-reject'],/consumer rpipe! producer/);
 assert.match(byId['stop-then-get-done'],/await producer\.get_done\(\)/);
});
test('connect immediately after spawn; DATA cannot enter STARTING receiver',() => {
 const {v,p,c}=pair(); const out=v.connect(p,c); assert.equal(out.ok,true); assert.equal(v.get_ready(p),null);
 assert.equal(v.emit(out.link,1).ok,false);
 v.ready(p); assert.equal(v.emit(out.link,7).ok,true);
 assert.deepEqual(out.link.queue,[7]); assert.deepEqual(out.link.delivered,[]);
 v.ready(c); assert.deepEqual(out.link.delivered,[7]); assert.deepEqual(out.link.queue,[]);
});
test('pre-READY queue is bounded, not silently unbounded',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c,{capacity:1}); v.ready(p);
 assert.equal(v.emit(r.link,10).ok,true); assert.equal(v.emit(r.link,11).error,'BACKPRESSURE');
 assert.equal(r.link.queue.length,1); v.ready(c); assert.deepEqual(r.link.delivered,[10]);
});
test('reverse-written duplicate edge rolls back with no second publication',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c);
 assert.equal(v.connect(p,c).error,'DUPLICATE_EDGE');
 assert.equal(v.links.length,1); assert.strictEqual(v.links[0],r.link);
});
test('deny direct cross-tenant, wrong type, closed ports and stale refs',() => {
 const v=new ActorReadyPipeOracle(),p=v.spawn({emits:'int',tenant:'a'}),c=v.spawn({receives:'int',tenant:'b'});
 assert.equal(v.connect(p,c).error,'TENANT_DENIED'); c.tenant='a'; c.receives='bool';
 assert.equal(v.connect(p,c).error,'TYPE'); c.receives='int'; v.stop(c);
 assert.equal(v.connect(p,c).error,'STOPPED');
 assert.equal(v.connect({...p},c).error,'STALE');
 assert.equal(v.links.length,0);
});
test('startup failure reports failed READY and terminal graph error, never success',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c); v.ready(p); v.emit(r.link,12);
 assert.equal(v.fail_start(c,'INIT_FAIL').ok,false);
 assert.equal(v.get_ready(c).error,'INIT_FAIL');
 assert.equal(r.link.done.error,'INIT_FAIL'); assert.deepEqual(r.link.queue,[]);
 assert.equal(v.ready(c).ok,false);
 assert.equal(v.retire(c).error,'INIT_FAIL');
 assert.strictEqual(v.get_done(c),c.done);
});
test('graceful stop preserves accepted DATA until receiver READY',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c,{capacity:1}); v.ready(p); v.emit(r.link,88);
 assert.equal(v.stop(p).ok,true); assert.equal(r.link.done,null);
 assert.equal(v.emit(r.link,99).error,'STOPPED_OR_NOT_READY');
 assert.equal(v.retire(p).error,'PENDING_PIPE'); v.ready(c);
 assert.deepEqual(r.link.delivered,[88]); assert.equal(r.link.done.ok,true);
 assert.equal(v.retire(p).ok,true);
});
test('DONE cannot publish with an outstanding actor resource loan',() => {
 const {v,p,c}=pair(); const r=v.connect(p,c);
 v.ready(p); v.ready(c); p.loans=1; v.stop(p);
 assert.equal(r.link.done.ok,true); assert.equal(v.retire(p).error,'PINNED_LOANS');
 assert.equal(v.get_done(p),null); p.loans=0; assert.equal(v.retire(p).ok,true);
 assert.strictEqual(v.get_done(p),p.done);
});
test('STOP before READY never invents initialization success',() => {
 const {v,p}=pair(); v.stop(p);
 assert.equal(v.get_ready(p).error,'STOPPED_BEFORE_READY'); assert.equal(v.ready(p).ok,false);
 assert.equal(v.retire(p).error,'STOPPED_BEFORE_READY');
 assert.strictEqual(v.get_ready(p),p.ready);
});
