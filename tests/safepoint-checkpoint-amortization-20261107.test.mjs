import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetDecision} from '../src/safepoint-policy.mjs';

// An executable reference to the compiler's cheap backedge counter.
// Checking a 64-bit physical counter in JS uses a safe-range integer here;
// production Java/LLVM use saturating 64-bit counters.
const interval = 128;
const limit = 512;
const probeDue = reductions => reductions > 0 && reductions % interval === 0;
const continuable = {hasHeapContinuation:true};

test('only every 128th committed backedge triggers a slow check, even after 512',()=>{
  let probes = 0;
  for (let reductions = 1; reductions <= 8192; ++reductions) {
    const due = probeDue(reductions);
    assert.equal(due, reductions % 128 === 0);
    if (due) ++probes;
    const result = budgetDecision({
      ...continuable, reductions, elapsedNs:0, probeDue:due,
    });
    if (reductions >= 512 && due) {
      assert.deepEqual(result, {decision:'HANDOFF',reason:'reduction-budget'},
        `overdue scheduled probe failed at ${reductions}`);
    } else {
      assert.equal(result.decision,'CONTINUE',
        `scheduler performed expensive work off the 128-step boundary at ${reductions}`);
    }
  }
  assert.equal(probes, 8192 / 128);
});

test('an omitted scheduled poll cannot bypass overdue fairness, but off-phase work stays cheap',()=>{
  for (const reductions of [512,640,768,1024,8192,0x100000000,Number.MAX_SAFE_INTEGER-127]) {
    assert.deepEqual(budgetDecision({
      ...continuable, reductions, elapsedNs:0, probeDue:false,
    }),{decision:'HANDOFF',reason:'reduction-budget'});
  }
  for (const reductions of [511,513,575,641,8193,Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(budgetDecision({
      ...continuable, reductions, elapsedNs:20_000_000,probeDue:false,
    }),{decision:'CONTINUE',reason:'probe-not-due'},
    `off-phase slow poll occurred at ${reductions}`);
  }
  // A certified guard-exit or explicit poll may request one immediate check.
  assert.deepEqual(budgetDecision({
    ...continuable,reductions:513,elapsedNs:0,probeDue:true,
  }),{decision:'HANDOFF',reason:'reduction-budget'});
});

test('overdue reductions never bypass borrow, guard, cleanup or host frame checks',()=>{
  const illegal = [
    ['liveBorrow','loan-across-suspension'],
    ['liveGuard','guard-across-suspension'],
    ['plainCritical','plain-critical-no-suspend'],
    ['hostFrame','host-frame-not-captured'],
    ['partialEffect','partial-effect-not-committed'],
  ];
  for (const [key,reason] of illegal) {
    assert.deepEqual(budgetDecision({
      ...continuable,reductions:8192,elapsedNs:0,probeDue:false,[key]:true,
    }),{decision:'DEFER',reason});
  }
  assert.deepEqual(budgetDecision({
    ...continuable,reductions:512,elapsedNs:0,probeDue:false,
    inCleanup:true,cleanupLowered:false,
  }),{decision:'DEFER',reason:'cleanup-not-lowered'});
  assert.deepEqual(budgetDecision({
    reductions:512,elapsedNs:0,probeDue:false,
  }),{decision:'DEFER',reason:'continuation-not-lowered'});
});

test('no runnable peer prevents scheduling but does not erase reduction debt',()=>{
  const pending = budgetDecision({
    ...continuable,reductions:8192,elapsedNs:0,probeDue:false,peerRunnable:false,
  });
  assert.deepEqual(pending,{decision:'CONTINUE',reason:'no-runnable-peer'});
  assert.deepEqual(budgetDecision({
    ...continuable,reductions:8320,elapsedNs:0,probeDue:false,peerRunnable:true,
  }),{decision:'HANDOFF',reason:'reduction-budget'});
});

test('counter and sampling inputs must be precise nonnegative integers and booleans',()=>{
  for (const invalid of [
    {reductions:-1},
    {reductions:1.5},
    {reductions:Number.MAX_SAFE_INTEGER+1},
    {reductions:NaN},
    {reductions:Infinity},
    {limit:0},
    {limit:-1},
    {limit:0.5},
    {elapsedNs:-1},
    {elapsedNs:1.2},
    {timeLimitNs:0},
    {timeLimitNs:2.5},
    {probeDue:'false'},
    {peerRunnable:0},
    {sampleInterval:0},
    {sampleInterval:129},
    {sampleInterval:65537},
    {sampleInterval:1.5},
  ]) {
    assert.throws(()=>budgetDecision({
      ...continuable,reductions:1,elapsedNs:0,probeDue:true,...invalid,
    }),TypeError,JSON.stringify(invalid));
  }
});

test('untrusted quotas never authorize a source-level handoff by themselves',()=>{
  for (const kind of ['auto-backedge','cooperate']) {
    const decision = budgetDecision({
      ...continuable,kind,untrusted:true,quotaContinuous:true,
      reductions:512,elapsedNs:0,probeDue:false,
    });
    assert.deepEqual(decision,{
      decision:kind==='auto-backedge'?'DEFER':'REJECT',
      reason:'untrusted-cooperation-not-certified',
    });
  }
  assert.deepEqual(budgetDecision({
    ...continuable,kind:'auto-backedge',untrusted:true,quotaContinuous:false,
    reductions:512,elapsedNs:0,probeDue:false,
  }),{decision:'DEFER',reason:'logical-quota-not-continuous'});
  // The model can show what a future certified engine would allow,
  // but its boolean is NOT a guest capability or a certification receipt.
  assert.deepEqual(budgetDecision({
    ...continuable,kind:'auto-backedge',untrusted:true,quotaContinuous:true,
    untrustedCooperationCertified:true,
    reductions:512,elapsedNs:0,probeDue:false,
  }),{decision:'HANDOFF',reason:'reduction-budget'});
});

