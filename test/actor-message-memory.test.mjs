import test from 'node:test';

import { ActorMessageMemoryOracle } from '../verification/actor-message-memory-reference.mjs';

// Model tests only, not source .ores compiled execution.

function check(x, description) { if (!x) throw new Error("message-region check: " + description); }

function reject(fn, description) {
  let denied = false; try { fn(); } catch { denied=true; } check(denied,description);
}

function runChecks() {
  const a = new ActorMessageMemoryOracle({actor:7,incarnation:2,maxOutstanding:2,maxBytes:16});
  const m1=a.admit(); const m2=a.admit();
  reject(()=>a.admit(),"bounded concurrent message admission");
  const t1=a.enter(m1,101);
  const p1=a.scratch(t1,8);
  a.write(t1,p1,new Uint8Array([1,2,3,4,5,6,7,8]));
  const ext=a.lease(t1);
  reject(()=>a.enter(m2,102),"one executing guest turn at a time");
  a.suspend(t1);
  reject(()=>a.read(t1,p1),"suspension drops active guest authority");
  const t2=a.enter(m2,102); const p2=a.scratch(t2,4);
  a.write(t2,p2,new Uint8Array([9,10,11,12]));
  check(a.allocatedBytes===12,"independent message regions");
  reject(()=>a.read(t2,p1),"other message scratch denied");
  reject(()=>a.read(t2,{...p2}),"forged scratch issuance");
  a.suspend(t2);
  const t3=a.enter(m1,103);
  check(a.read(t3,p1)[0]===1,"carrier migration retains awaiting scratch");
  reject(()=>a.scratch(t3,5),"quota includes suspended message");
  a.complete(t3);
  check(a.allocatedBytes===12,"external lease pins physical bytes");
  reject(()=>a.enter(m1,103),"completed message cannot resume");
  reject(()=>a.read(t3,p1),"completed turn revoked");
  check(a.stop()===false && !a.physicallyReclaimed,"stop deferred");
  reject(()=>a.admit(),"stop seals message admission");
  a.releaseLease(ext);
  reject(()=>a.releaseLease(ext),"double release denied");
  check(a.allocatedBytes===4 && a.outstanding===1,"lease release drains only first message");
  const t4=a.enter(m2,104);
  check(a.read(t4,p2)[0]===9,"suspended second message survives first teardown");
  a.complete(t4);
  check(a.allocatedBytes===0 && a.physicallyReclaimed,"final message enables retirement");
  reject(()=>a.read(t4,p2),"dead scratch token denied");
  const serial=new ActorMessageMemoryOracle({actor:1,incarnation:1,maxOutstanding:1,maxBytes:2});
  const ms=serial.admit(); const ts=serial.enter(ms,7);
  reject(()=>serial.scratch(ts,3),"small quota");
  const ps=serial.scratch(ts,2);
  reject(()=>serial.admit(),"serial admission while running");
  serial.suspend(ts);
  reject(()=>serial.admit(),"serial admission while suspended");
  const resumed=serial.enter(ms,8);
  check(serial.read(resumed,ps).length===2,"resuming serial frame");
  serial.complete(resumed);
  const ms2=serial.admit();
  reject(()=>serial.enter(ms,8),"stale epoch invalidation");
  const tnext=serial.enter(ms2,10);
  reject(()=>serial.read(tnext,ps),"old scratch token invalid after region recycling");
  serial.complete(tnext);
  check(serial.stop(),"idle stop");
  return true;
}

test('actor single-flight, parallel suspension, scratch, epoch and external-lease quiescence', runChecks);

