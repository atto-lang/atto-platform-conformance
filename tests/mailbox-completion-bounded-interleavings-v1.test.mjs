import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMailboxCompletionV1} from '../src/mailbox-completion-v1.mjs';

// SOURCE-FREE deterministic sequential-order exploration, NOT a concurrent
// runtime, linearizability, AOT, or compiled AttoLang guest proof.
const make = (op, expect, ticket) => ({op, expect, ...(ticket === undefined ? {} : {ticket})});

// Independent small reference: predicts each observable event from a short
// ordered history, then compares to the production candidate trace checker.
function oracle_trace(actions, capacity) {
  const state = {open:true, abrupt:false, queue:[], inFlight:new Set(),
    activeTasks:new Set(), pinnedLoans:new Set(), reclaimed:false};
  const events = [];
  for (const action of actions) {
    const [op, ticket] = action;
    let expected;
    switch (op) {
      case 'send':
        if (!state.open) expected = 'RESULT_ERR_CLOSED';
        else if (state.queue.length >= capacity) expected = 'RESULT_ERR_FULL';
        else {state.queue.push(ticket); expected = 'RESULT_OK';}
        break;
      case 'receive':
        if (state.queue.length > 0) {
          const next = state.queue.shift();
          state.inFlight.add(next);
          expected = `MESSAGE:${next}`;
        } else expected = state.open ? 'EMPTY' : 'CLOSED';
        break;
      case 'settle':
        if (state.inFlight.has(ticket)) {
          state.inFlight.delete(ticket);
          expected = 'SETTLED';
        } else expected = 'INVALID_SETTLEMENT';
        break;
      case 'stop_abrupt':
      case 'stop_graceful':
        if (!state.open) expected = 'ALREADY_STOPPED';
        else {
          state.open = false;
          state.abrupt = op === 'stop_abrupt';
          if (state.abrupt) state.queue = [];
          expected = 'STOPPED';
        }
        break;
      case 'task_begin':
        if (!state.open || state.activeTasks.has(ticket)) expected = 'DENIED';
        else {state.activeTasks.add(ticket); expected = 'STARTED';}
        break;
      case 'task_end':
        if (state.activeTasks.delete(ticket)) expected = 'RETIRED';
        else expected = 'INVALID_RETIRE';
        break;
      case 'loan_begin':
        if (!state.open || state.pinnedLoans.has(ticket)) expected = 'DENIED';
        else {state.pinnedLoans.add(ticket); expected = 'PINNED';}
        break;
      case 'loan_end':
        if (state.pinnedLoans.delete(ticket)) expected = 'RELEASED';
        else expected = 'INVALID_RELEASE';
        break;
      case 'get_done':
      case 'reclaim': {
        const quiescent = !state.open && !state.queue.length &&
          !state.inFlight.size && !state.activeTasks.size && !state.pinnedLoans.size;
        if (op === 'get_done') expected = quiescent ? 'DONE' : 'PENDING';
        else if (state.reclaimed) expected = 'ALREADY_RECLAIMED';
        else if (!quiescent) expected = 'NOT_QUIESCENT';
        else {state.reclaimed = true; expected = 'RECLAIMED';}
        break;
      }
      default: throw new Error(`Unrecognized independent operation ${op}`);
    }
    events.push(make(op, expected, ticket));
  }
  return events;
}

function visit_permutations(items, on_order) {
  const used = new Array(items.length).fill(false);
  const order = [];
  let explored = 0;
  function visit() {
    if (order.length === items.length) {
      on_order(order);
      explored++;
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(items[i]);
      visit();
      order.pop();
      used[i] = false;
    }
  }
  visit();
  return explored;
}

const check = (actions, capacity) => {
  const events = oracle_trace(actions, capacity);
  const result = checkMailboxCompletionV1({
    schema:'oreslang.mailbox_completion.v1', capacity, events,
  });
  assert.equal(result.status, 'MODEL_CONSISTENT');
  assert.equal(result.classification, 'SOURCE_FREE_CANDIDATE_ONLY');
  assert.equal(result.compiledGuestExecuted, false);
  assert.equal(result.nativeParityCertified, false);
  assert.equal(result.observations, actions.length);
};

test('20,160 send/receive/settle/stop/DONE/reclaim orders preserve admission and close', () => {
  let total = 0;
  for (const stop of ['stop_abrupt', 'stop_graceful']) {
    for (const capacity of [1, 2]) {
      const actions = [
        ['send', 'a'], ['send', 'b'], ['receive'], ['settle', 'a'],
        [stop], ['get_done'], ['reclaim'],
      ];
      assert.equal(visit_permutations(actions, order => check(order, capacity)), 5040);
      total += 5040;
    }
  }
  assert.equal(total, 20160);
});

test('10,080 Task/loan/stop/DONE/reclaim orders enforce physical completion', () => {
  let total = 0;
  for (const stop of ['stop_abrupt', 'stop_graceful']) {
    const actions = [
      ['task_begin', 't'], ['task_end', 't'], ['loan_begin', 'l'], ['loan_end', 'l'],
      [stop], ['get_done'], ['reclaim'],
    ];
    assert.equal(visit_permutations(actions, order => check(order, 1)), 5040);
    total += 5040;
  }
  assert.equal(total, 10080);
});
