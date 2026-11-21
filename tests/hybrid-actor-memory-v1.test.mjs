import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Executable SOURCE-FREE HOST REFERENCE GATES. These tests do not compile or
// execute an AttoLang actor or prove any backend's ABI, AOT, GC or isolation.
const registry = JSON.parse(readFileSync(new URL('../contracts/hybrid-actor-memory-v1.json', import.meta.url), 'utf8'));
const UINT32_MAX = 0xffff_ffffn;
const MAX_OFFSET = (UINT32_MAX - 1n) * 8n;
const STATES = new Set(['PASSED', 'FAILED', 'UNSUPPORTED', 'NOT_EXECUTED']);

function encode_ref32(offset) {
  if (typeof offset !== 'bigint' || offset < 0n || offset > MAX_OFFSET || offset % 8n !== 0n)
    throw new RangeError('invalid actor-local logical object start');
  return Number(offset / 8n + 1n);
}
function decode_ref32(word) {
  if (typeof word !== 'number' || !Number.isInteger(word) || word < 0 || word > Number(UINT32_MAX))
    throw new RangeError('invalid unsigned word');
  return word === 0 ? null : (BigInt(word) - 1n) * 8n;
}

// Deliberately does not use machine addresses as object or actor identities.
class ReferenceArena {
  constructor(actor, incarnation, logical_quota, shared_budget, {realtime = false} = {}) {
    this.actor = actor;
    this.incarnation = incarnation;
    this.logical_quota = logical_quota;
    this.shared_budget = shared_budget;
    this.realtime = realtime;
    this.cursor = 0n;
    this.committed = 0n;
    this.pins = 0;
    this.retired = false;
    this.values = new Map();
  }
  allocate(bytes) {
    if (this.retired || typeof bytes !== 'bigint' || bytes <= 0n) return null;
    const offset = (this.cursor + 7n) & ~7n;
    if (offset > MAX_OFFSET || offset + bytes > this.logical_quota || offset + bytes < offset) return null;
    const required = offset + bytes;
    if (this.realtime && required > this.committed) return null;
    const extra = required > this.committed ? required - this.committed : 0n;
    if (this.shared_budget.used + extra > this.shared_budget.limit) return null;
    const word = encode_ref32(offset);
    if (this.values.has(word)) throw new Error('object-start collision');
    this.shared_budget.used += extra;
    this.committed += extra;
    this.cursor = required;
    this.values.set(word, {value: 0, generation: 1});
    return {actor: this.actor, incarnation: this.incarnation, word, generation: 1};
  }
  check(handle) {
    if (this.retired || !handle || handle.actor !== this.actor || handle.incarnation !== this.incarnation)
      throw new Error('wrong actor or stale incarnation');
    const object = this.values.get(handle.word);
    if (!object || object.generation !== handle.generation) throw new Error('stale or invalid object');
    return object;
  }
  read(handle) { return this.check(handle).value; }
  write(handle, value) { this.check(handle).value = value; }
  // Simulates relocation accounting. No physical pages allocated in this model.
  relocate_to(replacement_bytes, {injected_failure = false} = {}) {
    if (this.retired || this.realtime || this.pins !== 0 || typeof replacement_bytes !== 'bigint' ||
        replacement_bytes < this.committed || replacement_bytes > this.logical_quota) return false;
    const old = this.committed;
    if (this.shared_budget.used + replacement_bytes > this.shared_budget.limit) return false;
    if (injected_failure) return false;
    this.shared_budget.used += replacement_bytes; // old + full new backing at peak
    this.committed = replacement_bytes;
    this.shared_budget.used -= old; // only after simulated scrub/free
    return true;
  }
  retire() {
    if (this.pins !== 0) throw new Error('outstanding lease');
    if (this.retired) return;
    this.retired = true;
    this.values.clear();
    this.shared_budget.used -= this.committed;
    this.committed = 0n;
  }
}

class HandleTableModel {
  constructor(actor, incarnation) {
    this.actor = actor;
    this.incarnation = incarnation;
    this.next = 1;
    this.table = new Map();
  }
  make(segment, byte_offset) {
    if (!Number.isSafeInteger(segment) || segment < 0 || typeof byte_offset !== 'bigint' || byte_offset < 0n)
      throw new RangeError('invalid segment locator');
    const slot = this.next++;
    this.table.set(slot, {segment, byte_offset, generation: 1, retired: false});
    return {actor: this.actor, incarnation: this.incarnation, slot, generation: 1};
  }
  resolve(h) {
    const e = this.table.get(h.slot);
    if (!e || e.retired || h.actor !== this.actor || h.incarnation !== this.incarnation ||
        e.generation !== h.generation) throw new Error('invalid handle');
    return {segment: e.segment, byte_offset: e.byte_offset};
  }
  revoke(h) {
    this.resolve(h);
    const e = this.table.get(h.slot);
    e.retired = true; // no wrap/reuse without separate formal proof
  }
}

test('manifest reserves all width/ownership/extension features without false implementation claims', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.format, 'atto.hybrid-actor-memory.v1');
  assert.equal(registry.status, 'TARGET_ONLY_NOT_GUEST_EXECUTED');
  assert.equal(registry.encoding.kind, 'offset8_plus_one');
  assert.equal(registry.encoding.word_bits, 32);
  assert.equal(registry.encoding.max_logical_start_bytes, MAX_OFFSET.toString());
  assert.equal(registry.policies.extended_abi_requires_explicit_version, true);
  assert.equal(registry.policies.no_silent_ref_widening, true);
  assert.equal(registry.policies.realtime_never_grows_in_turn, true);
  assert.equal(registry.execution_proof.backend_guest_execution, 'NOT_EXECUTED');
  assert.equal(registry.backends.length, 11);
  assert.equal(new Set(registry.backends).size, registry.backends.length);
  assert.equal(registry.optional_features.length, 20);
  assert.equal(new Set(registry.optional_features).size, 20);
  assert.ok(registry.cases.length >= 40);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  for (const backend of registry.backends) {
    assert.deepEqual(Object.keys(registry.feature_status[backend]).sort(), [...registry.optional_features].sort());
    for (const feature of registry.optional_features)
      assert.equal(registry.feature_status[backend][feature], 'NOT_EXECUTED');
  }
  for (const c of registry.cases) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.ok(['accept', 'reject'].includes(c.expect), c.id);
    assert.ok(['runtime', 'compile', 'static', 'link', 'evidence'].includes(c.phase), c.id);
    assert.ok(c.requirement.length > 25, c.id);
    assert.ok(STATES.has(c.aggregate_status) && c.aggregate_status === 'NOT_EXECUTED');
    assert.deepEqual(Object.keys(c.backend_status).sort(), [...registry.backends].sort());
    for (const status of Object.values(c.backend_status)) assert.equal(status, 'NOT_EXECUTED');
  }
  for (const group of ['reference', 'security', 'abi', 'growth', 'lifetime', 'transport', 'realtime', 'capability', 'value', 'evidence'])
    assert.ok(registry.cases.some(c => c.group === group), 'missing ' + group);
});

test('Ref32 unsigned 32-bit encoding covers first, high-bit and last addresses', () => {
  assert.equal(decode_ref32(0), null);
  for (const word of [1, 2, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff])
    assert.equal(encode_ref32(decode_ref32(word)), word);
  assert.equal(decode_ref32(0xffffffff), 34359738352n);
  assert.equal(encode_ref32(MAX_OFFSET), 0xffffffff);
  for (const bad of [1n, -8n, MAX_OFFSET + 8n, 8, null, undefined])
    assert.throws(() => encode_ref32(bad), RangeError);
  for (const bad of [-1, 1.5, 0x100000000, NaN, Infinity, '1', 1n, null])
    assert.throws(() => decode_ref32(bad), RangeError);
});

test('identical words in two actors never transport authority', () => {
  const budget = {used: 0n, limit: 100n};
  const a = new ReferenceArena('A', 1, 64n, budget);
  const b = new ReferenceArena('B', 1, 64n, budget);
  const pa = a.allocate(8n), pb = b.allocate(8n);
  assert.equal(pa.word, pb.word);
  a.write(pa, 91); b.write(pb, 13);
  assert.equal(a.read(pa), 91);
  assert.equal(b.read(pb), 13);
  assert.throws(() => a.read(pb), /wrong actor/);
  a.retire();
  assert.throws(() => a.read(pa), /stale/);
  assert.equal(b.read(pb), 13);
  b.retire();
  assert.equal(budget.used, 0n);
});

test('actor restart fences old incarnation even if encoded reference is reused', () => {
  const budget = {used: 0n, limit: 100n};
  const first = new ReferenceArena('A', 1, 64n, budget);
  const stale = first.allocate(8n);
  first.retire();
  const restarted = new ReferenceArena('A', 2, 64n, budget);
  const fresh = restarted.allocate(8n);
  assert.equal(stale.word, fresh.word);
  assert.throws(() => restarted.read(stale), /stale incarnation/);
  restarted.retire();
});

test('segmented handles need a distinct table ABI and stale tokens never resurrect', () => {
  const table = new HandleTableModel('A', 5);
  const h = table.make(7, MAX_OFFSET + 16n);
  assert.deepEqual(table.resolve(h), {segment: 7, byte_offset: MAX_OFFSET + 16n});
  assert.throws(() => table.resolve({...h, actor: 'B'}), /invalid/);
  table.revoke(h);
  assert.throws(() => table.resolve(h), /invalid/);
  assert.throws(() => table.make(-1, 0n), RangeError);
});

test('growth charges full old+new peak and failure is accounting/data neutral', () => {
  const budget = {used: 0n, limit: 32n};
  const a = new ReferenceArena('A', 9, 64n, budget);
  const h = a.allocate(8n);
  a.write(h, 42);
  assert.equal(a.relocate_to(26n), false); // 8 old + 26 new > 32
  assert.equal(a.relocate_to(30n, {injected_failure: true}), false);
  assert.equal(a.read(h), 42);
  assert.equal(a.committed, 8n);
  assert.equal(budget.used, 8n);
  assert.equal(a.relocate_to(24n), true); // peak 32; refund 8
  assert.equal(a.read(h), 42);
  assert.equal(budget.used, 24n);
  a.pins++;
  assert.equal(a.relocate_to(24n), false);
  assert.throws(() => a.retire(), /outstanding lease/);
  a.pins--;
  a.retire();
  assert.equal(budget.used, 0n);
});

test('actor hard-quota and prefault realtime never grow during actor turn', () => {
  const budget = {used: 0n, limit: 24n};
  const dynamic = new ReferenceArena('A', 1, 16n, budget);
  assert.ok(dynamic.allocate(16n));
  assert.equal(dynamic.allocate(8n), null);
  const realtime = new ReferenceArena('RT', 1, 16n, budget, {realtime: true});
  assert.equal(realtime.allocate(8n), null);
  assert.equal(realtime.relocate_to(8n), false);
  dynamic.retire();
  realtime.retire();
});

test('two-phase take/abort model never revokes sender before admission', () => {
  const owner = {actor: 'sender', live: true, payload: 42};
  function send(accepted) {
    if (!owner.live) throw new Error('already moved');
    if (!accepted) return {accepted: false, ownership: 'sender'};
    owner.live = false; // one linearized successful commit
    return {accepted: true, ownership: 'receiver', payload: owner.payload};
  }
  assert.deepEqual(send(false), {accepted: false, ownership: 'sender'});
  assert.equal(owner.live, true);
  assert.deepEqual(send(true), {accepted: true, ownership: 'receiver', payload: 42});
  assert.equal(owner.live, false);
  assert.throws(() => send(true), /already moved/);
});
