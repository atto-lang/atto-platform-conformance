import test from "node:test";
import assert from "node:assert/strict";
import {HttpActorAdmissionModel} from "../src/http-actor-admission-model-v1.mjs";

test("serial 1x1 has one request lifetime and one message lifetime",()=>{
 const m=new HttpActorAdmissionModel();
 const r=m.admit_request("first");
 assert.throws(()=>m.admit_request("second"),/request capacity/);
 const t=m.admit_message(r,"one");
 assert.throws(()=>m.admit_message(r,"two"),/message capacity/);
 m.enter_turn(t);
 m.close_response(r);
 m.complete_message(t);
 m.start_shutdown();
 assert.equal(m.shutdown_state(),"pending");
 assert.equal(m.snapshot().physical_turns,1);
 assert.equal(m.snapshot().request_count,1);
 assert.throws(()=>m.admit_request("late"),/sealed/);
 m.exit_turn(t);
 assert.equal(m.shutdown_state(),"quiescent");
});
test("3x4 bounds outstanding lifetimes, never simultaneous guest turns",()=>{
 const m=new HttpActorAdmissionModel({request_concurrency:3,message_concurrency:4});
 const request_ids=["a","b","c"].map(k=>m.admit_request(k));
 assert.throws(()=>m.admit_request("d"),/request capacity/);
 const messages=[0,1,2,3].map(i=>m.admit_message(request_ids[0],String(i)));
 assert.throws(()=>m.admit_message(request_ids[0],"4"),/message capacity/);
 m.enter_turn(messages[0]);
 assert.throws(()=>m.enter_turn(messages[1]),/physical execution already active/);
 m.exit_turn(messages[0]);
 m.enter_turn(messages[1]);
 m.complete_message(messages[1]);
 assert.throws(()=>m.enter_turn(messages[1]),/completed message/);
 m.exit_turn(messages[1]);
 assert.equal(m.snapshot().physical_turns,0);
 assert.deepEqual(m.snapshot().request_message_counts,[3,0,0]);
});
test("response close cannot retire physical message or release request slot",()=>{
 const m=new HttpActorAdmissionModel();
 const r=m.admit_request("one");
 const t=m.admit_message(r,"one");
 m.enter_turn(t);
 m.complete_message(t);
 m.close_response(r);
 assert.throws(()=>m.admit_request("two"),/request capacity/);
 assert.equal(m.snapshot().message_count,1);
 m.exit_turn(t);
 assert.equal(m.snapshot().request_count,0);
 assert.doesNotThrow(()=>m.admit_request("two"));
});
test("cancellation, generation and double completion cannot forge terminal success",()=>{
 const m=new HttpActorAdmissionModel();
 const r=m.admit_request("r");
 const t=m.admit_message(r,"m");
 m.enter_turn(t);
 m.cancel_request(r);
 m.start_shutdown();
 assert.equal(m.shutdown_state(),"pending");
 assert.throws(()=>m.recycle(),/quiescence/);
 assert.throws(()=>m.complete_message(t),/already completed/);
 assert.throws(()=>m.exit_turn(Object.freeze({...t})),/stale or forged/);
 m.exit_turn(t);
 assert.equal(m.shutdown_state(),"quiescent");
 m.recycle();
 assert.throws(()=>m.close_response(r),/stale/);
 assert.throws(()=>m.enter_turn(t),/stale/);
});
test("invalid quotas and forged capability identities fail before allocation",()=>{
 for(const n of [0,-1,1.5,65,Number.NaN]) {
   assert.throws(()=>new HttpActorAdmissionModel({request_concurrency:n}),/1\.\.64/);
   assert.throws(()=>new HttpActorAdmissionModel({message_concurrency:n}),/1\.\.64/);
 }
 const m=new HttpActorAdmissionModel();
 const r=m.admit_request("r");
 assert.throws(()=>m.admit_message(Object.freeze({...r}),"bad"),/forged/);
 const t=m.admit_message(r,"good");
 assert.throws(()=>m.enter_turn(Object.freeze({...t})),/forged/);
 assert.throws(()=>m.admit_request("r"),/capacity|duplicate/);
});
test("bounded adversarial action sequences never violate lifetime or physical turn limits",()=>{
 const actions=["admit_r","admit_m","enter","finish","exit","close","cancel","shutdown","force_stop","recycle"];
 for(let sequence=0;sequence<10000;sequence++){
   const model=new HttpActorAdmissionModel({request_concurrency:2,message_concurrency:2});
   let value=sequence,request=null,message=null;
   for(let step=0;step<4;step++){
     const action=actions[value%actions.length];value=Math.floor(value/actions.length);
     try {
       if(action==="admit_r")request=model.admit_request("r"+step);
       if(action==="admit_m" && request)message=model.admit_message(request,"m"+step);
       if(action==="enter" && message)model.enter_turn(message);
       if(action==="finish" && message)model.complete_message(message);
       if(action==="exit" && message)model.exit_turn(message);
       if(action==="close" && request)model.close_response(request);
       if(action==="cancel" && request)model.cancel_request(request);
       if(action==="shutdown")model.start_shutdown();
       if(action==="force_stop")model.force_stop();
       if(action==="recycle")model.recycle();
     } catch(error) {
       assert.ok(error instanceof Error,"expected explicit denial, not silent downgrade");
       assert.match(error.message,
         /admission sealed|capacity exhausted|already closed|already completed|stale or forged|cannot reenter|physical execution already active|not the executing physical turn|message cannot resume|duplicate request|duplicate message|cannot recycle before quiescence/,
         "unrecognized exception must not count as expected feature denial");
     }
     const snapshot=model.snapshot();
     assert.ok(snapshot.request_count<=2);
     assert.ok(snapshot.physical_turns<=1);
     assert.ok(snapshot.message_count<=4);
     assert.ok(snapshot.request_message_counts.every(n=>n<=2));
     if(snapshot.physical_turns===1)assert.ok(snapshot.message_count>=1);
     if(model.shutdown_state()==="quiescent") {
       assert.equal(snapshot.request_count,0);
       assert.equal(snapshot.message_count,0);
       assert.equal(snapshot.physical_turns,0);
     }
   }
 }
});

test("graceful drain blocks new requests but retains admitted request's messages",()=>{
 const m=new HttpActorAdmissionModel();
 const r=m.admit_request("original");
 m.start_shutdown();
 assert.throws(()=>m.admit_request("new"),/request admission sealed/);
 assert.equal(m.shutdown_state(),"pending");
 const first=m.admit_message(r,"completion");
 m.enter_turn(first);
 m.complete_message(first);
 m.close_response(r);
 assert.equal(m.shutdown_state(),"pending","physical turn remains active after response");
 m.exit_turn(first);
 assert.equal(m.shutdown_state(),"quiescent");
 assert.throws(()=>m.admit_message(r,"late"),/stale or forged/);
});
test("forced stop cancels all admitted lifetimes but cannot fake carrier exit",()=>{
 const m=new HttpActorAdmissionModel({request_concurrency:2,message_concurrency:2});
 const a=m.admit_request("a"),b=m.admit_request("b");
 const held=m.admit_message(a,"in-flight");
 m.admit_message(b,"queued");
 m.enter_turn(held);
 assert.equal(m.force_stop(),true);
 assert.equal(m.force_stop(),false,"forced stop must be single-owner");
 assert.equal(m.snapshot().request_count,1,"physical request remains reserved");
 assert.equal(m.snapshot().message_count,1,"physical turn cannot retire early");
 assert.equal(m.shutdown_state(),"pending");
 assert.throws(()=>m.admit_message(a,"late"),/message admission sealed/);
 assert.throws(()=>m.recycle(),/quiescence/);
 m.exit_turn(held);
 assert.equal(m.shutdown_state(),"quiescent");
 m.recycle();
 assert.equal(m.snapshot().force_stopped,false);
 assert.throws(()=>m.close_response(a),/stale/);
});
test("forged getters and proxies are never inspected before token authentication",()=>{
 const m=new HttpActorAdmissionModel();
 let touched=0;
 const poison=new Proxy({}, {get(){touched++;throw new Error("forged getter invoked");}});
 assert.throws(()=>m.admit_message(poison,"x"),/stale or forged/);
 assert.throws(()=>m.enter_turn(poison),/stale or forged/);
 assert.throws(()=>m.close_response(poison),/stale or forged/);
 assert.equal(touched,0,"untrusted token getters must not execute");
 const owner=m.admit_request("safe");
 const fake=Object.freeze({...owner});
 assert.throws(()=>m.admit_message(fake,"x"),/stale or forged/);
});
test("abandoned request cannot complete without cancellation or response close",()=>{
 const m=new HttpActorAdmissionModel();
 const a=m.admit_request("stalled");
 m.start_shutdown();
 assert.equal(m.shutdown_state(),"pending");
 const t=m.admit_message(a,"late-existing");
 m.complete_message(t);
 assert.equal(m.shutdown_state(),"pending","response still owns its request lifetime");
 m.force_stop();
 assert.equal(m.shutdown_state(),"quiescent");
});

test("untrusted callers cannot mutate the private admission ledger",()=>{
 const m=new HttpActorAdmissionModel();
 assert.equal(Object.isExtensible(m),false);
 assert.equal(m.requests,undefined);
 assert.equal(m.messages,undefined);
 assert.equal(m.sealed,undefined);
 const token=m.admit_request("one");
 const message=m.admit_message(token,"mail");
 assert.equal(Reflect.set(m,"request_concurrency",100),false);
 assert.equal(Reflect.set(m,"requests",new Map()),false);
 assert.equal(Reflect.set(m,"sealed",false),false);
 assert.throws(()=>m.admit_request("two"),/request capacity/);
 m.start_shutdown();
 assert.throws(()=>m.admit_request("late"),/sealed/);
 m.enter_turn(message);
 m.complete_message(message);
 m.close_response(token);
 assert.equal(m.shutdown_state(),"pending");
 m.exit_turn(message);
 assert.equal(m.shutdown_state(),"quiescent");
});

test("cancellation during dispatch retains request until physical handoff is reconciled",()=>{
 const m=new HttpActorAdmissionModel();
 const req=m.admit_request("handoff"), msg=m.admit_message(req,"work");
 m.begin_handoff(msg);
 assert.equal(m.snapshot().pending_handoffs,1);
 assert.throws(()=>m.begin_handoff(msg),/message cannot begin handoff/);
 assert.throws(()=>m.enter_turn(msg),/message cannot resume/);
 assert.throws(()=>m.complete_message(msg),/message handoff active/);
 m.start_shutdown();
 m.force_stop();
 assert.equal(m.snapshot().request_count,1);
 assert.equal(m.snapshot().message_count,1);
 assert.equal(m.shutdown_state(),"pending");
 assert.throws(()=>m.recycle(),/quiescence/);
 m.end_handoff(msg);
 assert.equal(m.shutdown_state(),"quiescent");
 assert.throws(()=>m.end_handoff(msg),/stale or forged/);
});
test("request and message record accessors cannot leak mutable capability internals",()=>{
 const m=new HttpActorAdmissionModel();
 const req=m.admit_request("private"),msg=m.admit_message(req,"private");
 for(const name of ["_request","_message","_retire_message","_retire_request"])
   assert.equal(m[name],undefined,"mutable internal method is visible: "+name);
 assert.equal(m.snapshot().request_count,1);
 assert.equal(m.snapshot().message_count,1);
 m.start_shutdown();
 m.force_stop();
 assert.equal(m.shutdown_state(),"quiescent");
 assert.throws(()=>m.enter_turn(msg),/stale or forged/);
});
