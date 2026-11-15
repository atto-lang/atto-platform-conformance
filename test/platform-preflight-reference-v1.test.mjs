import test from "node:test";
import assert from "node:assert/strict";
import {replay_classify, mobile_copy_preflight, mailbox_peek_length, MAX_U64}
  from "../src/platform-preflight-reference-v1.mjs";

test("replay classification is immutable, bounded and fail-closed", () => {
  const state = Object.freeze({highest:100n,bitmap:1n});
  assert.equal(replay_classify(state, 100n), "DUPLICATE");
  assert.equal(replay_classify(state, 99n), "ACCEPT");
  assert.equal(replay_classify(state, 36n), "STALE");
  assert.equal(replay_classify(state, MAX_U64), "ACCEPT");
  assert.equal(replay_classify(state, 0n), "INVALID_SEQUENCE");
  assert.equal(replay_classify({highest:100n,bitmap:0n}, 101n), "INVALID_ARGUMENT");
  assert.equal(replay_classify({highest:0n,bitmap:1n}, 1n), "INVALID_ARGUMENT");
  assert.equal(replay_classify({highest:2n,bitmap:8n}, 1n), "INVALID_ARGUMENT");
  assert.equal(replay_classify({highest:0n,bitmap:0n}, 1n), "ACCEPT");
  assert.equal(state.highest, 100n);
  assert.equal(state.bitmap, 1n);
});
test("mobile copy preflight never turns overlap into admission", () => {
  const base = Object.freeze({length:3,capacity:3,source_present:true,scratch_present:true,overlaps:false});
  assert.equal(mobile_copy_preflight(base), "OK");
  assert.equal(mobile_copy_preflight({...base, overlaps:true}), "INVALID_ARGUMENT");
  assert.equal(mobile_copy_preflight({...base, capacity:2}), "BUFFER_TOO_SMALL");
  assert.equal(mobile_copy_preflight({...base, source_present:false}), "INVALID_ARGUMENT");
  assert.equal(mobile_copy_preflight({...base, length:65537}), "MESSAGE_TOO_LARGE");
  assert.equal(mobile_copy_preflight({...base, length:0, source_present:false, scratch_present:false}), "OK");
});
test("mailbox preflight validates state without consumption", () => {
  const slots=Object.freeze([0,3,0,0,0,0,0,0]);
  const box=Object.freeze({head:1,tail:2,count:1,slots});
  assert.deepEqual(mailbox_peek_length(box), {status:"OK",length:3});
  assert.deepEqual(mailbox_peek_length({...box,tail:1,count:0}), {status:"EMPTY",length:0});
  assert.deepEqual(mailbox_peek_length({...box,tail:3}), {status:"INVALID_ARGUMENT",length:0});
  assert.deepEqual(mailbox_peek_length({...box,slots:[0,65,0,0,0,0,0,0]}), {status:"INVALID_ARGUMENT",length:0});
  assert.equal(box.count,1);
});
