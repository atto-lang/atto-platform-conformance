import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetDecision, mayEnterActorWhileParked} from '../src/safepoint-policy.mjs';

const safe = {hasHeapContinuation:true};

test('poll-disabled budget never forces a logical carrier handoff', () => {
  assert.deepEqual(budgetDecision({reductions:700,elapsedNs:3000000,probeDue:false,...safe}),
    {decision:'CONTINUE',reason:'probe-not-due'});
  assert.deepEqual(budgetDecision({reductions:511,elapsedNs:1999999,...safe}),
    {decision:'CONTINUE',reason:'budget-remaining'});
});

test('only an admitted safepoint with a runnable peer may hand off', () => {
  assert.deepEqual(budgetDecision({reductions:512,elapsedNs:0,...safe,peerRunnable:false}),
    {decision:'CONTINUE',reason:'no-runnable-peer'});
  assert.deepEqual(budgetDecision({reductions:512,elapsedNs:2000000,...safe}),
    {decision:'HANDOFF',reason:'reduction-budget'});
  assert.deepEqual(budgetDecision({reductions:0,elapsedNs:2000000,...safe}),
    {decision:'HANDOFF',reason:'time-budget'});
  assert.deepEqual(budgetDecision({reductions:512,elapsedNs:0,...safe,liveBorrow:true}),
    {decision:'DEFER',reason:'loan-across-suspension'});
});

test('reentry is explicit await-only and forbidden under actor/critical ownership', () => {
  assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true}),true);
  for (const restriction of [{serialActor:true},{criticalTicket:true},{exclusiveStateLoan:true}])
    assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true,...restriction}),false);
  for (const reason of ['cooperate','auto-backedge','generator-value','select'])
    assert.equal(mayEnterActorWhileParked({reason,reentryPolicy:true}),false);
});
