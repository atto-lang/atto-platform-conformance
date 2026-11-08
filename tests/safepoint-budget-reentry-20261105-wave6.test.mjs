import test from 'node:test';
import assert from 'node:assert/strict';
import {admitSafePoint, budgetDecision, mayEnterActorWhileParked} from '../src/safepoint-policy.mjs';

test('the budget poll does not preempt on wall time alone before probe', () => {
  assert.deepEqual(budgetDecision({reductions:511,elapsedNs:10000000,probeDue:false}),
    {decision:'CONTINUE',reason:'probe-not-due'});
  assert.deepEqual(budgetDecision({
    reductions:100000,elapsedNs:10000000,probeDue:false,hasHeapContinuation:true
  }), {decision:'HANDOFF',reason:'reduction-budget'});
  assert.deepEqual(budgetDecision({
    reductions:100000,elapsedNs:10000000,probeDue:false,hasHeapContinuation:true,liveBorrow:true
  }), {decision:'DEFER',reason:'loan-across-suspension'});
  assert.deepEqual(budgetDecision({
    reductions:512,elapsedNs:0,probeDue:false,hasHeapContinuation:false
  }), {decision:'DEFER',reason:'continuation-not-lowered'});
  assert.deepEqual(budgetDecision({reductions:512,elapsedNs:0,hasHeapContinuation:true,peerRunnable:false}),
    {decision:'CONTINUE',reason:'no-runnable-peer'});
});

test('a potential preemption defers rather than yielding through live ownership', () => {
  const decision = budgetDecision({reductions:512,elapsedNs:0,
    hasHeapContinuation:true,liveBorrow:true});
  assert.deepEqual(decision,{decision:'DEFER',reason:'loan-across-suspension'});
  assert.deepEqual(admitSafePoint({kind:'await',hasHeapContinuation:true,liveBorrow:true}),
    {decision:'REJECT',reason:'loan-across-suspension'});
});

test('actor reentry is explicit and forbidden for parked turns with actor-held state', () => {
  assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true}),true);
  for (const deny of [{serialActor:true},{criticalTicket:true},{exclusiveStateLoan:true}]) {
    assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true,...deny}),false);
  }
  assert.equal(mayEnterActorWhileParked({reason:'cooperate',reentryPolicy:true}),false);
});
