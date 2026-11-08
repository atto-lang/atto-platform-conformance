import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetDecision} from '../src/safepoint-policy.mjs';

// An executable reference to the compiler's cheap backedge counter.
// Checking a 64-bit physical counter in JS uses a safe-range integer here;
// production Java/LLVM use saturating 64-bit counters.
const interval = 64;
const limit = 512;
const probeDue = reductions => reductions >= limit || reductions % interval === 0;
const continuable = {hasHeapContinuation:true};

test('every 64th committed backedge is checked until 512; all later backedges check',()=>{
  let probes = 0;
  for (let reductions = 1; reductions <= 8192; ++reductions) {
    const due = probeDue(reductions);
    assert.equal(due, reductions >= 512 || reductions % 64 === 0);
    if (due) ++probes;
    const result = budgetDecision({
      ...continuable, reductions, elapsedNs:0, probeDue:due,
    });
    if (reductions < 512) {
      assert.equal(result.decision,'CONTINUE', `premature handoff at ${reductions}`);
    } else {
      assert.deepEqual(result, {decision:'HANDOFF',reason:'reduction-budget'},
        `overdue dispatch was allowed to escape at ${reductions}`);
    }
  }
  assert.equal(probes, 7 + (8192 - 512 + 1));
});

test('an incorrectly omitted probe cannot evade the hard reduction cap',()=>{
  for (const reductions of [512,513,575,576,1024,8192,0x100000000,Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(budgetDecision({
      ...continuable, reductions, elapsedNs:0, probeDue:false,
    }),{decision:'HANDOFF',reason:'reduction-budget'});
  }
  assert.deepEqual(budgetDecision({
    ...continuable, reductions:511, elapsedNs:20_000_000,probeDue:false,
  }),{decision:'CONTINUE',reason:'probe-not-due'});
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
    ...continuable,reductions:8193,elapsedNs:0,probeDue:false,peerRunnable:true,
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
  ]) {
    assert.throws(()=>budgetDecision({
      ...continuable,reductions:1,elapsedNs:0,probeDue:true,...invalid,
    }),TypeError,JSON.stringify(invalid));
  }
});
