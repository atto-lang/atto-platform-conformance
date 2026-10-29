import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrustedActorIdentitySidecar } from './identity-sidecar.mjs';
import { actor_storage_key, encode_actor_id } from './identity.mjs';

const s = value => ({ kind:'string', value });
const id = key => ({ tenant:'tenant-a', namespace:'commerce', actor_type:'cart', key });
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'ores-identity-sidecar-'));
  const path=join(dir,'store.sqlite');
  return {path,open:()=>new TrustedActorIdentitySidecar({path,tenantId:'tenant-a'}),
    cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const w=(id,opId,extra={})=>({id,stateName:'main',opId,epoch:1,expectedVersion:0,payload:Buffer.from('state'),...extra});
test('string, signed and unsigned keys persist as distinct actors across reopening',()=>{
  const f=fixture();try{
    const a=id(s('42')),b=id({kind:'u64',value:42n}),c=id({kind:'i64',value:42n});
    let p=f.open();
    for(const [i,x] of [a,b,c].entries()){p.activate({id:x,epoch:1});assert.equal(p.enqueue(w(x,'op'+i)).durable,false);}
    assert.equal(p.flush().filter(x=>x.status==='committed').length,3);
    p.close();p=f.open();
    for(const x of [a,b,c]){assert.equal(p.load({id:x,stateName:'main'}).version,1);p.activate({id:x,epoch:2});}
    assert.throws(()=>p.enqueue(w(a,'stale',{epoch:1,expectedVersion:1})),/STALE_EPOCH/);
    p.close();
  }finally{f.cleanup();}
});
test('compound and UUID logical IDs retain persistent identity across restarts',()=>{
  const f=fixture();try{
    const actors=[id({kind:'compound',items:[s('north'),{kind:'u64',value:7n}]}),
      id({kind:'uuid',value:'019b2a65-961b-7ad8-823a-69d9e2ae3a31'})];
    let p=f.open();
    for(const [i,x] of actors.entries()){p.activate({id:x,epoch:1});p.enqueue(w(x,'tx'+i));}
    p.flush();p.close();p=f.open();
    for(const x of actors)assert.equal(p.load({id:x,stateName:'main'}).snapshot.payload.toString(),'state');
    p.close();
  }finally{f.cleanup();}
});
test('tenant forgery and unregistered actor writes are refused',()=>{
  const f=fixture();try{const p=f.open();
    const wrong={...id(s('42')),tenant:'tenant-b'};
    assert.throws(()=>p.activate({id:wrong,epoch:1}),/WRONG_TENANT/);
    assert.throws(()=>p.enqueue(w(wrong,'fake')),/WRONG_TENANT/);
    assert.throws(()=>p.load({id:wrong,stateName:'main'}),/WRONG_TENANT/);
    assert.throws(()=>p.enqueue(w(id(s('not-activated')),'bad')),/UNKNOWN_ACTOR_ID/);
    assert.throws(()=>p.activate({id:id(s('\ud800')),epoch:1}),/INVALID_ACTOR_ID/);
    p.close();
  }finally{f.cleanup();}
});
test('canonical-ID mismatch at an occupied hash slot fails closed',()=>{
  const f=fixture();try{const actorId=id(s('42'));const p=f.open();
    p.activate({id:actorId,epoch:1});
    const db=new DatabaseSync(f.path);
    db.prepare('UPDATE actor_id_bindings SET canonical_actor_id=? WHERE tenant=? AND actor=?')
      .run(encode_actor_id(id(s('not-42'))),'tenant-a',actor_storage_key(actorId));
    db.close();
    assert.throws(()=>p.activate({id:actorId,epoch:2}),/ACTOR_ID_HASH_COLLISION/);
    assert.throws(()=>p.enqueue(w(actorId,'op')),/ACTOR_ID_HASH_COLLISION/);
    assert.throws(()=>p.load({id:actorId,stateName:'main'}),/ACTOR_ID_HASH_COLLISION/);
    p.close();
  }finally{f.cleanup();}
});
test('same identity and different named states preserve separate CAS versions',()=>{
  const f=fixture();try{const p=f.open(),actorId=id(s('account-5'));
    p.activate({id:actorId,epoch:1});
    p.enqueue(w(actorId,'one',{stateName:'cart'}));
    p.enqueue(w(actorId,'two',{stateName:'settings'}));
    assert.equal(p.flush().filter(x=>x.status==='committed').length,2);
    assert.equal(p.load({id:actorId,stateName:'cart'}).version,1);
    assert.equal(p.load({id:actorId,stateName:'settings'}).version,1);
    p.close();
  }finally{f.cleanup();}
});
