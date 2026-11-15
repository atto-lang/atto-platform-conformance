import {types as utilTypes} from 'node:util';
/**
 * Source-free, bounded trace oracle for positive-capacity try writech.
 * This is NOT a guest compiler/runtime test or evidence of backend parity.
 * Capacity-zero rendezvous and actual waiter scheduling are out of scope.
 */
const OPS = new Set(['write', 'read', 'close']);
const MAX_EVENTS = 10;
const MAX_STATES = 100_000;
const fail = message => { throw new Error('INVALID_TRY_WRITECH_HISTORY: ' + message); };
const ownData = (value, keys) => {
  if (utilTypes.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('plain object required');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) fail('unknown field');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(d, 'value')) fail('accessor field');
  }
};
const token = s => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(s);
const time = t => Number.isSafeInteger(t) && t >= 0 && t <= 100_000;

export function validateTryWritechHistory(input) {
  ownData(input, ['schema', 'capacity', 'events']);
  if (input.schema !== 'oreslang.try_writech_linearizability.v1') fail('wrong schema');
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 4)
    fail('capacity must be 1..4 (rendezvous not modeled)');
  if (utilTypes.isProxy(input.events) || !Array.isArray(input.events) ||
      input.events.length < 1 || input.events.length > MAX_EVENTS)
    fail('bounded event list required');
  const ids = new Set();
  const ticks = new Set();
  for (const e of input.events) {
    ownData(e, ['id', 'op', 'payload', 'invoke', 'complete', 'result']);
    if (!token(e.id) || ids.has(e.id)) fail('invalid or repeated operation id');
    ids.add(e.id);
    if (!OPS.has(e.op)) fail('unknown operation');
    if (e.op === 'write' ? !token(e.payload) : Object.hasOwn(e, 'payload'))
      fail('payload is required only for writes');
    if (!time(e.invoke) || !time(e.complete) || e.invoke >= e.complete ||
        ticks.has(e.invoke) || ticks.has(e.complete)) fail('invalid or ambiguous timestamps');
    ticks.add(e.invoke); ticks.add(e.complete);
    if (typeof e.result !== 'string' || !/^[A-Z][A-Za-z0-9_:-]{0,63}$/.test(e.result))
      fail('invalid result');
    const expected = e.op === 'write'
      ? ['ACCEPTED', 'FULL:' + e.payload, 'CLOSED:' + e.payload]
      : e.op === 'read' ? ['NONE', 'CHANNEL_CLOSED'] : ['CLOSED', 'ALREADY_CLOSED'];
    if (!expected.includes(e.result) && !(e.op === 'read' &&
      /^VALUE:[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(e.result))) fail('invalid result variant');
  }
  return input;
}

const initial = () => ({open: true, queue: [], ownership: {}});
export function tryWritechTransition(state, event, capacity) {
  const next = {open: state.open, queue: [...state.queue], ownership: {...state.ownership}};
  let result;
  if (event.op === 'write') {
    const p = event.payload;
    // Full/Closed payloads can be retried. A receiver may also resend a read value.
    // This oracle cannot prove caller/actor identities; it only rejects a second
    // admission while the same payload remains in the channel.
    if (next.ownership[p] === 'queued')
      return {state: next, result: 'INVALID_OWNERSHIP'};
    if (!next.open) result = 'CLOSED:' + p;
    else if (next.queue.length === capacity) result = 'FULL:' + p;
    else { next.queue.push(p); next.ownership[p] = 'queued'; result = 'ACCEPTED'; }
  } else if (event.op === 'read') {
    if (next.queue.length) {
      const p = next.queue.shift(); next.ownership[p] = 'recipient'; result = 'VALUE:' + p;
    } else result = next.open ? 'NONE' : 'CHANNEL_CLOSED';
  } else if (event.op === 'close') {
    result = next.open ? 'CLOSED' : 'ALREADY_CLOSED';
    next.open = false; // Previously admitted payloads remain drainable.
  } else fail('unknown operation');
  return {state: next, result};
}

export function checkTryWritechLinearizability(input, {maxStates = MAX_STATES} = {}) {
  validateTryWritechHistory(input);
  if (!Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > MAX_STATES)
    fail('invalid search budget');
  const events = input.events;
  const before = events.map(e => events.reduce((mask, prior, i) =>
    prior.complete < e.invoke ? mask | (1 << i) : mask, 0));
  const target = (1 << events.length) - 1;
  const seen = new Set();
  let explored = 0;
  let exhausted = false;
  function walk(mask, state, path) {
    if (mask === target) return path;
    const key = mask + '|' + JSON.stringify(state);
    if (seen.has(key)) return null;
    if (++explored > maxStates) { exhausted = true; return null; }
    seen.add(key);
    for (let i = 0; i < events.length; i++) {
      const bit = 1 << i;
      if ((mask & bit) || (mask & before[i]) !== before[i]) continue;
      const {state: next, result} = tryWritechTransition(state, events[i], input.capacity);
      if (result !== events[i].result) continue;
      const found = walk(mask | bit, next, [...path, events[i].id]);
      if (found) return found;
      if (exhausted) return null;
    }
    return null;
  }
  const witness = walk(0, initial(), []);
  return {
    status: witness ? 'LINEARIZABLE' : exhausted ? 'INCONCLUSIVE' : 'NOT_LINEARIZABLE',
    classification: 'BOUNDED_SOURCE_FREE_ORACLE_ONLY', witness,
    explored, compiledGuestExecuted: false, nativeParityCertified: false
  };
}
