// A strictly source-free conformance oracle. No real Oreslang compiler or
// native host executes these tests; passing them is NEVER backend evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/actor-registered-resource-quota-v1.json', import.meta.url), 'utf8'));

function reject(code) { return Object.assign(new Error(code), {code}); }
function requireThat(ok, code) { if (!ok) throw reject(code); }

class RegisteredResourceOracle {
  #scopes = new Set();
  #records = new Map();
  #closed = false;
  #quarantined = 0;
  #physical = 0;
  constructor(maxHandles = 4, maxBytes = 64) {
    this.root = this.scope(null, maxHandles, maxBytes);
  }
  scope(parent, handles, bytes) {
    requireThat(Number.isSafeInteger(handles) && handles > 0, 'BAD_LIMIT');
    requireThat(Number.isSafeInteger(bytes) && bytes >= 0, 'BAD_LIMIT');
    if (parent) {
      requireThat(this.#scopes.has(parent), 'FORGED_SCOPE');
      requireThat(parent.live, 'REVOKED');
      requireThat(handles <= parent.maxHandles && bytes <= parent.maxBytes,
        'ESCALATION');
    }
    const scope = {parent, maxHandles:handles, maxBytes:bytes,
      live:true, handles:0, bytes:0};
    this.#scopes.add(scope);
    return scope;
  }
  ancestors(scope) {
    requireThat(this.#scopes.has(scope), 'FORGED_SCOPE');
    const ancestors = [];
    for (let cursor=scope; cursor; cursor=cursor.parent) ancestors.push(cursor);
    return ancestors;
  }
  revoke(scope) {
    requireThat(this.#scopes.has(scope), 'FORGED_SCOPE');
    scope.live = false;
  }
  register(scope, bytes) {
    if (this.#closed) throw reject('SHUTDOWN');
    requireThat(Number.isSafeInteger(bytes) && bytes >= 0, 'BAD_BYTES');
    const ancestors = this.ancestors(scope);
    for (const ancestor of ancestors) {
      requireThat(ancestor.live, 'REVOKED');
      requireThat(ancestor.handles < ancestor.maxHandles, 'HANDLE_QUOTA');
      requireThat(bytes <= ancestor.maxBytes - ancestor.bytes, 'BYTE_QUOTA');
    }
    // Reference assumes a trusted, serialized host broker. Native backends
    // must provide this atomicity and exact actor incarnation checks.
    for (const ancestor of ancestors) {
      ancestor.handles++;
      ancestor.bytes += bytes;
    }
    const handle = Object.freeze(Object.create(null));
    this.#records.set(handle, {ancestors, bytes, loans:0,
      released:false, unregistered:false, closeAttempts:0});
    this.#physical++;
    return handle;
  }
  record(handle) {
    const record = this.#records.get(handle);
    requireThat(record, 'FORGED_RECEIPT');
    requireThat(!record.released, 'RETIRED');
    return record;
  }
  borrow(handle) {
    const record = this.record(handle);
    requireThat(!record.unregistered && !this.#closed, 'SEALED');
    record.loans++;
  }
  releaseLoan(handle) {
    const record = this.record(handle);
    requireThat(record.loans > 0, 'LOAN_UNDERFLOW');
    record.loans--;
    if (record.loans === 0 && record.unregistered) this.#retire(handle, record);
  }
  unregister(handle) {
    const record = this.record(handle);
    requireThat(!record.unregistered, 'DUPLICATE_TRANSFER');
    record.unregistered = true;
    if (record.loans === 0) this.#retire(handle, record);
  }
  close(handle, physicalSuccess) {
    const record = this.record(handle);
    record.closeAttempts++;
    requireThat(record.loans === 0, 'LOAN_ACTIVE');
    if (!physicalSuccess) return false;
    this.#retire(handle, record);
    return true;
  }
  #retire(handle, record) {
    requireThat(!record.released, 'DUPLICATE_RETIRE');
    for (const a of record.ancestors) {
      requireThat(a.handles > 0 && a.bytes >= record.bytes, 'UNDERFLOW');
    }
    record.released = true;
    for (const a of record.ancestors) {
      a.handles--;
      a.bytes -= record.bytes;
    }
    this.#physical--;
    this.#records.delete(handle);
  }
  stop() { this.#closed = true; }
  lateCreationAfterShutdown() {
    requireThat(this.#closed, 'NOT_STOPPED');
    this.#quarantined++;
    return 'DENIED_BUT_RETAINED_FOR_QUARANTINE';
  }
  physicalRemaining() { return this.#physical + this.#quarantined; }
  drained() { return this.#physical === 0 && this.#quarantined === 0; }
}

test('contract is explicit about all five unverified native/guest backends', () => {
  assert.equal(contract.schema, 'oreslang.actor-registered-resource-quota.v1');
  assert.equal(contract.version, 1);
  assert.equal(contract.verification, 'SOURCE_FREE_REFERENCE_NOT_COMPILED_GUEST_PROOF');
  assert.equal(contract.promotion.sourceFreeModelIsBackendProof, false);
  assert.equal(contract.promotion.actualCompiledOreslangGuestRequired, true);
  assert.equal(contract.promotion.zeroStepActionsAccepted, false);
  assert.equal(contract.minimumScenarios.length, 12);
  assert.equal(new Set(contract.minimumScenarios).size, 12);
  assert.deepEqual(Object.keys(contract.backendStatus).sort(),
    ['forge','java','llvm','net','wasm']);
  for (const status of Object.values(contract.backendStatus))
    assert.equal(status, 'PENDING_EXECUTED_NATIVE_AND_GUEST_PROOF');
});

test('attenuation is an intersection, including sibling aggregate handles', () => {
  const m = new RegisteredResourceOracle();
  const parent = m.scope(m.root, 2, 64);
  const a = m.scope(parent, 1, 48), b = m.scope(parent, 2, 64);
  const h1 = m.register(a, 40);
  assert.throws(() => m.register(a, 0), {code:'HANDLE_QUOTA'});
  assert.throws(() => m.register(b, 25), {code:'BYTE_QUOTA'});
  const h2 = m.register(b, 24);
  assert.throws(() => m.register(b, 0), {code:'HANDLE_QUOTA'});
  assert.throws(() => m.scope(parent, 3, 64), {code:'ESCALATION'});
  m.close(h1, true); m.close(h2, true);
  assert.equal(m.drained(), true);
});

test('unknown-size resource still consumes a physical handle slot', () => {
  const m = new RegisteredResourceOracle(1, 0);
  const h = m.register(m.root, 0);
  assert.throws(() => m.register(m.root, 0), {code:'HANDLE_QUOTA'});
  assert.throws(() => m.register(m.root, 1), {code:'HANDLE_QUOTA'});
  m.unregister(h);
  assert.equal(m.drained(), true);
});

test('revoke blocks new registration without refunding an existing handle', () => {
  const m = new RegisteredResourceOracle();
  const restricted = m.scope(m.root, 1, 16);
  const sibling = m.scope(m.root, 1, 16);
  const live = m.register(restricted, 16);
  m.revoke(restricted);
  assert.throws(() => m.register(restricted, 0), {code:'REVOKED'});
  assert.equal(restricted.handles, 1);
  const independent = m.register(sibling, 1);
  m.close(independent, true);
  assert.equal(restricted.handles, 1);
  m.close(live, true);
  assert.equal(m.drained(), true);
});

test('unregister ownership transfer holds quota until last physical loan', () => {
  const m = new RegisteredResourceOracle(1, 8);
  const h = m.register(m.root, 8);
  m.borrow(h);
  m.unregister(h);
  assert.equal(m.root.handles, 1);
  assert.equal(m.root.bytes, 8);
  assert.throws(() => m.register(m.root, 0), {code:'HANDLE_QUOTA'});
  m.releaseLoan(h);
  assert.equal(m.root.handles, 0);
  assert.equal(m.root.bytes, 0);
  assert.throws(() => m.unregister(h), {code:'FORGED_RECEIPT'});
});

test('failed physical close remains owned, retry succeeds exactly once', () => {
  const m = new RegisteredResourceOracle(1, 32);
  const h = m.register(m.root, 12);
  assert.equal(m.close(h, false), false);
  assert.equal(m.drained(), false);
  assert.equal(m.root.handles, 1);
  assert.equal(m.close(h, true), true);
  assert.equal(m.drained(), true);
  assert.throws(() => m.close(h, true), {code:'FORGED_RECEIPT'});
});

test('STOP denies new handles and never falsifies physical shutdown', () => {
  const m = new RegisteredResourceOracle(2, 32);
  const h = m.register(m.root, 20);
  m.stop();
  assert.throws(() => m.register(m.root, 0), {code:'SHUTDOWN'});
  assert.equal(m.lateCreationAfterShutdown(),
    'DENIED_BUT_RETAINED_FOR_QUARANTINE');
  assert.equal(m.drained(), false);
  m.close(h, true);
  assert.equal(m.drained(), false, 'late physical handle requires actual cleanup');
});

test('all permutations of stop/revoke/close never over-refund', () => {
  for (const order of [
    ['stop','revoke','close'], ['stop','close','revoke'],
    ['revoke','stop','close'], ['revoke','close','stop'],
    ['close','stop','revoke'], ['close','revoke','stop']]) {
    const m = new RegisteredResourceOracle(1, 8);
    const h = m.register(m.root, 8);
    for (const action of order) {
      if (action === 'stop') m.stop();
      if (action === 'revoke') m.revoke(m.root);
      if (action === 'close') m.close(h, true);
      assert.ok(m.root.handles === 0 || m.root.handles === 1);
    }
    assert.equal(m.root.handles, 0);
    assert.equal(m.root.bytes, 0);
  }
});
