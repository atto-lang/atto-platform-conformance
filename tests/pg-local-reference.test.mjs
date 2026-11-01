import test from 'node:test';
import assert from 'node:assert/strict';
import {PgLocalReference} from '../src/pg-local-reference.mjs';

const owner = (actor,generation=1,isolate='tenant') => ({runtime:'vm',isolate,actor,generation});
const registry = () => new PgLocalReference({runtime:'vm',isolate:'tenant',maxGroups:2,maxGroupsPerActor:2});

test('two group memberships are independent and never imply actor ownership',()=>{
 const pg=registry();const a=pg.createGroup('a',2),b=pg.createGroup('b',2);
 pg.registerActor(owner('worker'));
 assert.equal(pg.join(a,owner('worker')),true);
 assert.equal(pg.join(a,owner('worker')),false);
 assert.equal(pg.join(b,owner('worker')),true);
 assert.equal(pg.leave('a',owner('worker')),true);
 assert.deepEqual(pg.snapshot('b',2).members,['worker:1']);
 assert.deepEqual(pg.snapshot('a',2).members,[]);
});

test('group ID ABA rejects old snapshot and join capability',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 pg.registerActor(owner('worker'));pg.join(cap,owner('worker'));
 const old=pg.snapshot('room',2);
 assert.equal(pg.closeGroup('room'),true);
 const newer=pg.createGroup('room',2);pg.join(newer,owner('worker'));
 assert.equal(pg.isLiveMember(old,'worker:1'),false);
 assert.throws(()=>pg.join(cap,owner('worker')),/PG_REF_DENIED/);
 assert.equal(pg.snapshot('room',2).members.length,1);
});

test('join permit rotation does not invalidate existing membership',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);pg.registerActor(owner('a'));
 pg.join(cap,owner('a'));const snapshot=pg.snapshot('room',2);
 const fresh=pg.rotateJoin(cap);
 assert.equal(pg.isLiveMember(snapshot,'a:1'),true);
 assert.throws(()=>pg.join(cap,owner('a')),/PG_REF_DENIED/);
 assert.equal(pg.join(fresh,owner('a')),false);
});

test('recipient quota rejects without delivery or snapshot copy',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 for(const actor of ['a','b']){pg.registerActor(owner(actor));pg.join(cap,owner(actor));}
 let calls=0;const send=()=>{calls++;return true;};
 assert.deepEqual(pg.broadcast('room',1,send),{status:'RECIPIENT_LIMIT',accepted:0,rejected:0,stale:0,snapshotCount:0});
 assert.equal(calls,0);
 assert.deepEqual(pg.snapshot('room',0).members,[]);
});

test('reentrant group close produces one accepted and one stale recipient',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 for(const actor of ['a','b']){pg.registerActor(owner(actor));pg.join(cap,owner(actor));}
 const report=pg.broadcast('room',2,()=>{pg.closeGroup('room');return true;});
 assert.deepEqual(report,{status:'OK',accepted:1,rejected:0,stale:1,snapshotCount:2});
});

test('mailbox saturation is per-recipient not an atomic broadcast rollback',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 for(const actor of ['a','b']){pg.registerActor(owner(actor));pg.join(cap,owner(actor));}
 const report=pg.broadcast('room',2,actor=>actor==='a:1');
 assert.equal(report.accepted,1);assert.equal(report.rejected,1);
 assert.equal(report.accepted+report.rejected+report.stale,2);
});

test('retire and reuse actor ID never revives previous generation membership',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 pg.registerActor(owner('a'));pg.join(cap,owner('a'));const prior=pg.snapshot('room',2);
 pg.retireActor(owner('a'));pg.registerActor(owner('a',2));pg.join(cap,owner('a',2));
 assert.equal(pg.isLiveMember(prior,'a:1'),false);
 assert.deepEqual(pg.snapshot('room',2).members,['a:2']);
 assert.throws(()=>pg.retireActor(owner('a',1)),/PG_REF_DENIED/);
});

test('foreign isolate and forged join token fail closed',()=>{
 const pg=registry(),cap=pg.createGroup('room',2);
 assert.throws(()=>pg.registerActor(owner('a',1,'foreign')),/PG_REF_DENIED/);
 pg.registerActor(owner('a'));
 assert.throws(()=>pg.join(Object.freeze({kind:'local-pg-join'}),owner('a')),/PG_REF_DENIED/);
 assert.throws(()=>pg.join(cap,owner('a',1,'foreign')),/PG_REF_DENIED/);
});

test('actor and group quotas reject without partial admission',()=>{
 const pg=new PgLocalReference({runtime:'vm',isolate:'tenant',maxGroups:1,maxGroupsPerActor:1});
 const cap=pg.createGroup('room',1);pg.registerActor(owner('a'));pg.registerActor(owner('b'));
 pg.join(cap,owner('a'));
 assert.throws(()=>pg.join(cap,owner('b')),/PG_REF_DENIED/);
 assert.throws(()=>pg.createGroup('other',1),/PG_REF_DENIED/);
 assert.deepEqual(pg.snapshot('room',1).members,['a:1']);
});

test('no guest pg or cross-node implementation is claimed',()=>{
 const pg=registry();assert.deepEqual(pg.status(),{sourceGuestImplemented:false,clusterPgImplemented:false});
});
