/** Candidate source-free actor mailbox admission + physical completion oracle.
 * A deterministic lifecycle projection, not a concurrent linearizability proof.
 * This input validator is Node.js-specific, not a guest runtime primitive.
 */
import {types as nodeTypes} from 'node:util';
const allowed = new Set(['send', 'receive', 'settle', 'stop_abrupt', 'stop_graceful',
  'task_begin', 'task_end', 'loan_begin', 'loan_end', 'get_done', 'reclaim']);
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(x);
const invalid = why => { throw new Error('INVALID_MAILBOX_COMPLETION_TRACE: ' + why); };
// Validate ordinary own data fields before reading any input-owned values.
const dataRecord = (value, allowedKeys, requiredKeys) =>
  value !== null && typeof value === 'object' &&
  !nodeTypes.isProxy(value) && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
  }) &&
  requiredKeys.every(key => Object.hasOwn(value, key));

export function checkMailboxCompletionV1(input) {
  if (!dataRecord(input, ['schema', 'capacity', 'events'],
      ['schema', 'capacity', 'events'])) invalid('input fields');
  if (input.schema !== 'oreslang.mailbox_completion.v1' ||
      !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 4 ||
      nodeTypes.isProxy(input.events) || !Array.isArray(input.events) ||
      !input.events.length || input.events.length > 1000)
    invalid('bounds');
  // Reject Proxy arrays before introspection, including already revoked
  // proxies whose Array.isArray / getPrototypeOf operations would throw.
  // An accessor slot must not execute code while validation reads events.
  const events = input.events;
  if (Object.getPrototypeOf(events) !== Array.prototype ||
      Reflect.ownKeys(events).length !== events.length + 1) invalid('event array');
  for (let index = 0; index < events.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(events, String(index));
    if (!entry || !Object.hasOwn(entry, 'value')) invalid('event array');
  }
  const s = {mode:'OPEN', queue:[], inflight:new Set(), accepted:new Set(),
    tasks:new Set(), loans:new Set(), reclaimed:false, results:[]};
  for (const e of events) {
    if (!dataRecord(e, ['op', 'ticket', 'expect'], ['op', 'expect']) ||
        !allowed.has(e.op) || typeof e.expect !== 'string') invalid('event fields');
    const withId = ['send','settle','task_begin','task_end','loan_begin','loan_end'].includes(e.op);
    if (withId !== Object.hasOwn(e,'ticket') || (withId && !id(e.ticket))) invalid('ticket');
    let actual;
    switch (e.op) {
      case 'send':
        if (s.mode !== 'OPEN') actual='RESULT_ERR_CLOSED';
        else if (s.queue.length === input.capacity) actual='RESULT_ERR_FULL';
        else if (s.accepted.has(e.ticket)) invalid('duplicate send ticket');
        else {s.accepted.add(e.ticket);s.queue.push(e.ticket);actual='RESULT_OK';}
        break;
      case 'receive':
        if (s.queue.length) {const t=s.queue.shift();s.inflight.add(t);actual='MESSAGE:'+t;}
        else actual=s.mode === 'OPEN'?'EMPTY':'CLOSED';
        break;
      case 'settle':
        if (!s.inflight.delete(e.ticket)) actual='INVALID_SETTLEMENT';
        else actual='SETTLED';
        break;
      case 'stop_abrupt':
      case 'stop_graceful':
        if (s.mode !== 'OPEN') actual='ALREADY_STOPPED';
        else {s.mode=e.op === 'stop_abrupt'?'ABRUPT':'GRACEFUL';
          if (s.mode === 'ABRUPT') s.queue.length=0;
          actual='STOPPED';}
        break;
      case 'task_begin':
        if (s.mode !== 'OPEN' || s.tasks.has(e.ticket)) actual='DENIED';
        else {s.tasks.add(e.ticket);actual='STARTED';}
        break;
      case 'task_end': actual=s.tasks.delete(e.ticket)?'RETIRED':'INVALID_RETIRE';break;
      case 'loan_begin':
        if (s.mode !== 'OPEN' || s.loans.has(e.ticket)) actual='DENIED';
        else {s.loans.add(e.ticket);actual='PINNED';}
        break;
      case 'loan_end': actual=s.loans.delete(e.ticket)?'RELEASED':'INVALID_RELEASE';break;
      case 'get_done':
        actual=s.mode !== 'OPEN' && !s.queue.length && !s.inflight.size &&
          !s.tasks.size && !s.loans.size?'DONE':'PENDING';break;
      case 'reclaim':
        if (s.reclaimed) actual='ALREADY_RECLAIMED';
        else if (s.mode !== 'OPEN' && !s.queue.length && !s.inflight.size &&
            !s.tasks.size && !s.loans.size) {s.reclaimed=true;actual='RECLAIMED';}
        else actual='NOT_QUIESCENT';
        break;
    }
    if (e.expect !== actual) invalid('observed '+e.op+' '+e.expect+' but model requires '+actual);
    s.results.push(actual);
  }
  return {status:'MODEL_CONSISTENT',classification:'SOURCE_FREE_CANDIDATE_ONLY',
    compiledGuestExecuted:false,nativeParityCertified:false,
    terminal:s.mode !== 'OPEN',reclaimed:s.reclaimed,observations:s.results.length};
}
