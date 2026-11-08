import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/immutable-containers-critical-v1.json', import.meta.url), 'utf8'));

// Source-FREE reference implementation, not a guest runtime, lock or compiler.
// Map/Set Object.freeze() would not freeze their mutable backing store, so
// snapshot entries instead use a null-prototype, frozen, copy-on-write record.
function freezeValue(value) {
  if (value instanceof PersistentMapModel) return value;
  if (typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'bigint' || (typeof value === 'number' &&
        Number.isFinite(value) && Number.isSafeInteger(value))) return value;
  throw new TypeError('mutable, closure, FFI or actor-local values are not Sendable frozen leaves');
}
class PersistentMapModel {
  constructor(entries = Object.create(null)) {
    const next = Object.create(null);
    for (const key of Object.keys(entries)) {
      if (typeof key !== 'string' || key.length > 256) throw new TypeError('invalid key');
      next[key] = freezeValue(entries[key]);
    }
    this.entries = Object.freeze(next);
    Object.freeze(this);
  }
  get(key) { return Object.hasOwn(this.entries, key) ? this.entries[key] : undefined; }
  with(key, value) {
    if (typeof key !== 'string' || key.length > 256) throw new TypeError('invalid key');
    const next = Object.assign(Object.create(null), this.entries);
    next[key] = freezeValue(value);
    return new PersistentMapModel(next);
  }
  without(key) {
    const next = Object.assign(Object.create(null), this.entries);
    delete next[key];
    return new PersistentMapModel(next);
  }
}

class CriticalSnapshotRootModel {
  #inCritical = false;
  #root = new PersistentMapModel();
  #revision = 0;
  #loans = new Map();
  #retiring = new Set();

  // Models a compiler-enforced non-suspending critical body, not an actual
  // OS/actor lock: no new async callback is admitted as a protected body.
  critical(callback) {
    if (callback.constructor.name === 'AsyncFunction') throw new TypeError('critical may not suspend');
    if (this.#inCritical) throw new Error('reentrant critical denied');
    this.#inCritical = true;
    try {
      const result = callback();
      if (result && typeof result.then === 'function')
        throw new TypeError('critical callback must be synchronous');
      return result;
    } finally { this.#inCritical = false; }
  }
  snapshot() {
    // Atomically read version+root in a single critical operation; a root
    // itself remains immutable and readable outside the critical section.
    return this.critical(() => {
      const root = this.#root;
      this.#loans.set(root, (this.#loans.get(root) ?? 0) + 1);
      let released = false;
      return Object.freeze({ root, revision: this.#revision, release: () => {
        if (released) return;
        released = true;
        const next = this.#loans.get(root) - 1;
        if (next === 0) { this.#loans.delete(root); this.#retiring.delete(root); }
        else this.#loans.set(root, next);
      } });
    });
  }
  publish(expectedRevision, candidate) {
    if (!(candidate instanceof PersistentMapModel))
      throw new TypeError('mutable candidate not admitted');
    return this.critical(() => {
      if (this.#revision !== expectedRevision) return false;
      if (this.#revision === Number.MAX_SAFE_INTEGER)
        throw new RangeError('revision overflow');
      const old = this.#root;
      this.#root = candidate;
      this.#revision += 1;
      if ((this.#loans.get(old) ?? 0) > 0) this.#retiring.add(old);
      return true;
    });
  }
  get version() { return this.#revision; }
  get retiredPinned() { return this.#retiring.size; }
}

test('contract applies to all backends without implying guest execution', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.rules.guestRefFieldBits, 32);
  assert.equal(contract.rules.sourceImplementation.startsWith('portable .atto'), true);
  for (const backend of contract.backends)
    assert.equal(contract.evidence[backend], 'NOT_EXECUTED');
  assert.equal(contract.vectors.length, 16);
  assert.equal(new Set(contract.vectors.map(x => x.id)).size, 16);
});

test('all three native immutable data container categories are specified', () => {
  assert.deepEqual(contract.containers.map(x => x.kind),
    ['PersistentMap<K,V>', 'PersistentSet<T>', 'PersistentList<T>']);
  assert.ok(contract.containers.every(x => x.mutability === 'transitive-immutable'));
});

test('old persistent snapshots remain unchanged across with/without updates', () => {
  const initial = new PersistentMapModel().with('a', 1);
  const updated = initial.with('a', 2).with('b', 3);
  const removed = updated.without('a');
  assert.equal(initial.get('a'), 1);
  assert.equal(updated.get('a'), 2);
  assert.equal(removed.get('a'), undefined);
  assert.equal(updated.get('b'), 3);
  assert.equal(initial.get('b'), undefined);
  assert.ok(Object.isFrozen(initial.entries));
});

test('Object.freeze of Map is not accepted as a deeply immutable container', () => {
  const mutable = Object.freeze(new Map([['a', 1]]));
  assert.throws(() => new PersistentMapModel().with('unsafe', mutable), /mutable/);
  mutable.set('a', 2);
  assert.equal(mutable.get('a'), 2, 'reference model makes false shallow-freeze proof visible');
});

test('nested mutable values, closures, arrays and foreign tokens fail admission', () => {
  for (const bad of [[], {}, new Map(), new Set(), () => 1,
    Promise.resolve(1), Object.freeze({x: 1}), {offset32: 1, actor: 'foreign'},
    NaN, Infinity, 1.5]) {
    assert.throws(() => new PersistentMapModel().with('x', bad), TypeError);
  }
});

test('independent immutable nested maps can be structurally shared', () => {
  const nested = new PersistentMapModel().with('z', 7);
  const old = new PersistentMapModel().with('nested', nested);
  const fresh = old.with('other', 8);
  assert.equal(old.get('nested'), nested);
  assert.equal(fresh.get('nested'), nested);
  assert.equal(fresh.get('other'), 8);
  assert.equal(old.get('other'), undefined);
});

test('the exact keys "__proto__" and constructor are ordinary immutable entries', () => {
  const map = new PersistentMapModel().with('__proto__', 11).with('constructor', 12);
  assert.equal(map.get('__proto__'), 11);
  assert.equal(map.get('constructor'), 12);
  assert.equal(map.entries.toString, undefined);
});

test('critical takes a precomputed candidate and publishes one versioned root', () => {
  const root = new CriticalSnapshotRootModel();
  const snap = root.snapshot();
  const candidate = snap.root.with('value', 10);
  assert.equal(root.publish(snap.revision, candidate), true);
  const fresh = root.snapshot();
  assert.equal(fresh.revision, 1);
  assert.equal(fresh.root.get('value'), 10);
  assert.equal(snap.root.get('value'), undefined);
  snap.release(); fresh.release();
});

test('two competing writers from one version have exactly one winner', () => {
  const root = new CriticalSnapshotRootModel();
  const s1 = root.snapshot(), s2 = root.snapshot();
  assert.equal(root.publish(s1.revision, s1.root.with('value', 101)), true);
  assert.equal(root.publish(s2.revision, s2.root.with('value', 202)), false);
  const now = root.snapshot();
  assert.equal(now.revision, 1);
  assert.equal(now.root.get('value'), 101);
  s1.release(); s2.release(); now.release();
});

test('a stale candidate cannot mutate published data or consume a reader lease', () => {
  const cell = new CriticalSnapshotRootModel();
  const old = cell.snapshot();
  const candidate = old.root.with('a', 3);
  assert.equal(cell.publish(0, candidate), true);
  assert.equal(cell.publish(0, old.root.with('a', 999)), false);
  assert.equal(old.root.get('a'), undefined);
  assert.equal(cell.retiredPinned, 1);
  old.release();
  assert.equal(cell.retiredPinned, 0);
});

test('active snapshot readers delay reclamation until their leases are released', () => {
  const cell = new CriticalSnapshotRootModel();
  const a = cell.snapshot(), b = cell.snapshot();
  assert.equal(cell.publish(0, a.root.with('x', 1)), true);
  assert.equal(cell.retiredPinned, 1);
  a.release(); assert.equal(cell.retiredPinned, 1);
  b.release(); assert.equal(cell.retiredPinned, 0);
  b.release(); assert.equal(cell.retiredPinned, 0);
});

test('immutable publication rejects invalid mutable candidate without modifying root', () => {
  const cell = new CriticalSnapshotRootModel();
  assert.throws(() => cell.publish(0, new Map()), TypeError);
  assert.equal(cell.version, 0);
  const current = cell.snapshot();
  assert.equal(current.root.get('a'), undefined);
  current.release();
});

test('critical cannot execute an async callback and rejects nested reentrancy', () => {
  const cell = new CriticalSnapshotRootModel();
  assert.throws(() => cell.critical(async () => 5), /may not suspend/);
  assert.throws(() => cell.critical(() => cell.critical(() => 1)), /reentrant/);
  assert.equal(cell.critical(() => 33), 33);
});

test('required compiler negative cases cover both critical/suspends orders', () => {
  const negatives = contract.sourceCases.filter(x => x.role === 'expected-compile-reject');
  assert.equal(negatives.length, 4);
  assert.ok(negatives.some(x => x.source.includes('await sleep(')));
  assert.ok(negatives.some(x => x.source.includes('critical suspends fnc')));
  assert.ok(negatives.some(x => x.source.includes('suspends critical fnc')));
  assert.ok(negatives.some(x => x.source.includes('ActorManagedRef')));
});

test('source contract separates shared immutable root from actor-local ref32', () => {
  const r = contract.rules;
  assert.equal(r.immutableSnapshotReadNoCriticalNeeded, true);
  assert.equal(r.rootAndRevisionReadMustBeAtomic, true);
  assert.equal(r.buildNewRootOutsideCritical, true);
  assert.equal(r.criticalBodyMaySuspend, false);
  assert.equal(r.sharedSnapshotRequiresExplicitSendableSharedRegionCapability, true);
  assert.equal(r.rejectRawActorHeapRef32CrossingActor, true);
  assert.equal(r.sendableDoesNotImplySerializable, true);
});

test('critical entry may wait but callback cannot suspend or block in critical', () => {
  const r = contract.rules;
  assert.equal(r.criticalEntryContentionMaySuspendEligibleCaller, true);
  assert.equal(r.criticalBlockInsideSuspendsFunctionAllowed, true);
  assert.equal(r.criticalSuspendsFunctionForbidden, true);
  assert.equal(r.suspendsCriticalFunctionForbidden, true);
  assert.equal(r.noFfiOrBlockingIoInsideCritical, true);
  assert.equal(r.noRetryLoopUnderCritical, true);
});
