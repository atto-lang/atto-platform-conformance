import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMailboxCompletionV1 as check} from '../src/mailbox-completion-v1.mjs';
const x=(op,expect,ticket)=>({op,expect,...(ticket===undefined?{}:{ticket})});
const checkEvents=(events,capacity=1)=>check({schema:'oreslang.mailbox_completion.v1',capacity,events});
const reject=(events)=>assert.throws(()=>checkEvents(events),/INVALID_MAILBOX_COMPLETION_TRACE/);

test('send Result reports admission, never handler completion',()=>{
  const out=checkEvents([x('send','RESULT_OK','a'),x('send','RESULT_ERR_FULL','b'),
    x('get_done','PENDING'),x('receive','MESSAGE:a'),x('settle','SETTLED','a'),
    x('stop_graceful','STOPPED'),x('get_done','DONE')]);
  assert.equal(out.compiledGuestExecuted,false);
  assert.equal(out.nativeParityCertified,false);
});
test('graceful close seals new admission but drains accepted FIFO',()=>{
  checkEvents([x('send','RESULT_OK','a'),x('stop_graceful','STOPPED'),
    x('send','RESULT_ERR_CLOSED','late'),x('get_done','PENDING'),
    x('receive','MESSAGE:a'),x('settle','SETTLED','a'),x('get_done','DONE')]);
});
test('abrupt stop removes queued admission, never creates a delivery',()=>{
  checkEvents([x('send','RESULT_OK','a'),x('stop_abrupt','STOPPED'),
    x('receive','CLOSED'),x('send','RESULT_ERR_CLOSED','late'),x('get_done','DONE')]);
  reject([x('send','RESULT_OK','a'),x('stop_abrupt','STOPPED'),x('receive','MESSAGE:a')]);
});
test('get_done and reclamation wait for in-flight, Task and loan retirement',()=>{
  checkEvents([x('send','RESULT_OK','a'),x('receive','MESSAGE:a'),
    x('task_begin','STARTED','t'),x('loan_begin','PINNED','p'),
    x('stop_abrupt','STOPPED'),x('get_done','PENDING'),x('reclaim','NOT_QUIESCENT'),
    x('settle','SETTLED','a'),x('get_done','PENDING'),
    x('task_end','RETIRED','t'),x('get_done','PENDING'),
    x('loan_end','RELEASED','p'),x('get_done','DONE'),
    x('reclaim','RECLAIMED'),x('reclaim','ALREADY_RECLAIMED')]);
});
test('duplicate settlement cannot retire twice, unknown releases do not create credit',()=>{
  checkEvents([x('send','RESULT_OK','a'),x('receive','MESSAGE:a'),
    x('settle','SETTLED','a'),x('settle','INVALID_SETTLEMENT','a'),
    x('loan_end','INVALID_RELEASE','missing'),x('stop_abrupt','STOPPED'),x('get_done','DONE')]);
  reject([x('send','RESULT_OK','a'),x('receive','MESSAGE:a'),
    x('settle','SETTLED','a'),x('settle','SETTLED','a')]);
});
test('no new physical Task or loan after stop',()=>{
  checkEvents([x('stop_graceful','STOPPED'),x('task_begin','DENIED','late-task'),
    x('loan_begin','DENIED','late-pin'),x('get_done','DONE')]);
});
test('reject forged completion and unexpected fields',()=>{
  reject([x('stop_abrupt','STOPPED'),x('get_done','PENDING')]);
  reject([x('send','RESULT_OK','a'),x('get_done','DONE')]);
  reject([x('send','RESULT_OK','a'),x('send','RESULT_OK','a')]);
  assert.throws(()=>check({schema:'oreslang.mailbox_completion.v1',capacity:1,
    events:[{op:'stop_abrupt',expect:'STOPPED',forged:true}]}),/INVALID_MAILBOX_COMPLETION_TRACE/);
  assert.throws(()=>check({schema:'oreslang.mailbox_completion.v1',capacity:0,
    events:[x('get_done','DONE')]}),/INVALID_MAILBOX_COMPLETION_TRACE/);
});
