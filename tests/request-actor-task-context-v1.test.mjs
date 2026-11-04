import test from 'node:test';
import assert from 'node:assert/strict';
import {RequestContextScopeModel as Store} from '../src/request-actor-task-context-v1.mjs';
const A={domain:1,slot:7,generation:3}, A2={domain:1,slot:7,generation:4};
const B={domain:1,slot:8,generation:3};
const meta=i=>({request_id:'req'+i,trace_id:'trace'+i,tenant_id:'trustedTenant',deadline_tick:500});
const bad=fn=>assert.throws(fn,/INVALID_REQUEST_CONTEXT_MODEL/);

test('request context survives physical carrier migration without TLS capture',()=>{
  const s=new Store(2),h=s.create(A,meta(1));
  assert.equal(s.current('carrier1'),null);
  s.with_turn(h,A,'carrier1',true,()=>{
    assert.equal(s.current('carrier1').trace_id,'trace1');
    assert.equal(s.current('carrier2'),null);
  });
  assert.equal(s.current('carrier1'),null);
  s.with_turn(h,A,'carrier2',true,()=>{
    assert.equal(s.current('carrier2').trace_id,'trace1');
    assert.equal(s.current('carrier1'),null);
  });
  assert.equal(s.close(h,A),true);
  assert.equal(s.available,2);
});

test('actor reuse never shares request-local metadata across requests',()=>{
  const s=new Store(2),h1=s.create(A,meta(1)),h2=s.create(A,meta(2));
  s.with_turn(h1,A,'physical1',true,()=>{
    assert.equal(s.current('physical1').request_id,'req1');
    s.with_turn(h2,A,'physical2',true,()=>{
      assert.equal(s.current('physical2').request_id,'req2');
      assert.equal(s.current('physical1').request_id,'req1');
    });
    assert.equal(s.current('physical2'),null);
  });
  assert.equal(s.close(h1,A),true);
  s.with_turn(h2,A,'physical3',true,()=>{
    assert.equal(s.current('physical3').trace_id,'trace2');
  });
  assert.equal(s.close(h2,A),true);
});

test('3, 8 and 15 simultaneously bound physical carriers see isolated requests',()=>{
  for(const n of [3,8,15]){
    const s=new Store(15),handles=Array.from({length:n},(_,i)=>s.create(A,meta(i+1)));
    const visit=i=>{
      if(i===n){
        for(let j=0;j<n;j++)
          assert.equal(s.current('carrier'+j).request_id,'req'+(j+1));
        assert.equal(s.live_leases,n);return;
      }
      s.with_turn(handles[i],A,'carrier'+i,true,()=>visit(i+1));
    };
    visit(0);
    assert.equal(s.live_leases,0);
    for(const h of handles)assert.equal(s.close(h,A),true);
    assert.equal(s.available,15);
  }
});

test('nested scope restores prior carrier binding even when inner callback throws',()=>{
  const s=new Store(2),h=s.create(A,meta(1)),other=s.create(B,meta(2));
  s.with_turn(h,A,'carrier',true,()=>{
    assert.equal(s.current('carrier').request_id,'req1');
    assert.throws(()=>s.with_turn(other,B,'carrier',true,()=>{
      assert.equal(s.current('carrier').request_id,'req2');
      throw new Error('guest panic');
    }),/guest panic/);
    assert.equal(s.current('carrier').request_id,'req1');
  });
  assert.equal(s.current('carrier'),null);
  assert.equal(s.live_leases,0);
});

test('suspend exits binding; children pin lifetime until physical exit',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  const child=s.retain_child(h,A);
  s.with_turn(h,A,'worker1',true,()=>assert.equal(s.live_leases,2));
  assert.equal(s.current('worker1'),null);
  assert.equal(s.close(h,A),true);
  assert.deepEqual(s.status(h),{phase:'CLOSING',leases:1});
  assert.equal(s.available,0);
  bad(()=>s.with_turn(h,A,'worker2',true,()=>{}));
  s.release_child(child);
  assert.equal(s.available,1);
  assert.equal(s.status(h),null);
  bad(()=>s.release_child(child));
});

test('closing during active synchronous turn revokes lookup but delays recycling',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  s.with_turn(h,A,'carrier',true,()=>{
    assert.equal(s.available,0);
    assert.equal(s.close(h,A),true);
    assert.equal(s.current('carrier'),null);
    assert.equal(s.available,0);
  });
  assert.equal(s.available,1);
  assert.equal(s.close(h,A),false);
});

test('stale generation and stale actor incarnation fail before binding',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  bad(()=>s.with_turn(h,A2,'carrier',true,()=>{}));
  bad(()=>s.retain_child(h,A2));
  assert.equal(s.close(h,A2),false);
  assert.equal(s.close(h,A),true);
  const next=s.create(A2,meta(2));
  assert.equal(next.slot,h.slot);
  assert.equal(next.generation,h.generation+1);
  bad(()=>s.with_turn(h,A,'carrier',true,()=>{}));
  bad(()=>s.with_turn(next,A,'carrier',true,()=>{}));
  s.with_turn(next,A2,'carrier',true,()=>assert.equal(s.current('carrier').request_id,'req2'));
});

test('no request context on unadmitted, detached or producer callback',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  bad(()=>s.with_turn(h,A,'callbackThread',false,()=>{}));
  assert.equal(s.current('callbackThread'),null);
  assert.equal(s.live_leases,0);
  bad(()=>s.with_turn(h,A,'callbackThread',true,()=>Promise.resolve(1)));
  assert.equal(s.current('callbackThread'),null);
  assert.equal(s.live_leases,0);
});

test('metadata is immutable, bounded and not an ambient mutable authority map',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  s.with_turn(h,A,'carrier',true,()=>{
    const ctx=s.current('carrier');
    assert(Object.isFrozen(ctx));
    assert.throws(()=>{ctx.tenant_id='other';},TypeError);
  });
  bad(()=>s.create(A,{...meta(2),permission:'allow-net'}));
  bad(()=>s.create(A,{...meta(2),request_id:'../bad'}));
});

test('duplicate live request ID denied until actual pin drain, then permitted',()=>{
  const s=new Store(2),h=s.create(A,meta(1)),child=s.retain_child(h,A);
  bad(()=>s.create(B,meta(1)));
  assert.equal(s.close(h,A),true);
  bad(()=>s.create(B,meta(1))); // CLOSING still owns identity
  s.release_child(child);
  const next=s.create(B,meta(1));
  assert(next && next.generation>0);
});

test('bounded admission does not evict a live request or violate isolation',()=>{
  const s=new Store(1),h=s.create(A,meta(1));
  assert.equal(s.create(B,meta(2)),null);
  s.with_turn(h,A,'carrier',true,()=>assert.equal(s.current('carrier').request_id,'req1'));
  assert.equal(s.close(h,A),true);
  assert(s.create(B,meta(2)));
});

test('malformed host-owner, handle and leases fail closed',()=>{
  bad(()=>new Store(0));bad(()=>new Store(129));
  const s=new Store(1);
  bad(()=>s.create({domain:0,slot:1,generation:1},meta(1)));
  const h=s.create(A,meta(1));
  bad(()=>s.with_turn({...h,authority:true},A,'carrier',true,()=>{}));
  bad(()=>s.with_turn(h,A,'carrier',true,null));
  bad(()=>s.with_turn(h,A,'../carrier',true,()=>{}));
  bad(()=>s.release_child(999));
});

test('accessor-backed identities and request headers cannot execute during admission',()=>{
  const s=new Store(1),m=meta(1),owner={...A};
  Object.defineProperty(m,'trace_id',{get(){throw new Error('unauthorized side effect');}});
  bad(()=>s.create(A,m));
  Object.defineProperty(owner,'slot',{get(){throw new Error('owner getter');}});
  bad(()=>s.create(owner,meta(1)));
  assert.equal(s.available,1);
});
