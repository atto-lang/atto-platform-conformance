// SOURCE-FREE MODEL ONLY: not a compiled AttoLang guest or production lock.
import test from 'node:test';
import assert from 'node:assert/strict';

class DomainModel {
  #identities = new Map();
  #symbols = new Map();
  #public = new Set();
  #principals = new WeakSet();
  #principalsByKey = new Map();
  constructor(domain, { maxSymbols = 32 } = {}) {
    if (typeof domain !== 'string' || !domain) throw Error('invalid domain');
    if (!Number.isSafeInteger(maxSymbols) || maxSymbols < 1) throw Error('invalid symbol budget');
    Object.defineProperty(this, 'domain', { value: domain, enumerable: true });
    Object.defineProperty(this, 'maxSymbols', { value: maxSymbols, enumerable: true });
  }
  // Called only by trusted runtime, never exposed as a guest constructor.
  mintPrincipal(actor, incarnation) {
    if (!Number.isSafeInteger(actor) || !Number.isSafeInteger(incarnation) || incarnation < 1)
      throw Error('invalid principal');
    const key = JSON.stringify([actor, incarnation]);
    if (this.#principalsByKey.has(key)) return this.#principalsByKey.get(key);
    const p = Object.freeze({ actor, incarnation, domain: this.domain });
    this.#principals.add(p);
    this.#principalsByKey.set(key, p);
    return p;
  }
  valid(p) { return !!p && this.#principals.has(p); }
  // Compiler must resolve identity, including imports, before this is called.
  singleton(moduleId, declarationId, initialize) {
    if (![moduleId, declarationId].every(x => typeof x === 'string' && x.length > 0 && x.length <= 256)
        || typeof initialize !== 'function') throw Error('invalid singleton declaration');
    const id = JSON.stringify([moduleId, declarationId]);
    if (!this.#identities.has(id)) {
      const record = { state: 'initializing', value: undefined, error: undefined };
      this.#identities.set(id, record);
      try {
        const value = initialize();
        if (value && typeof value.then === 'function') throw Error('async initializer forbidden in v1');
        record.value = immutableCopy(value);
        record.state = 'ready';
      } catch (error) {
        record.error = error;
        record.state = 'failed';
      }
    }
    const entry = this.#identities.get(id);
    if (entry.state === 'initializing') throw Error('singleton dependency cycle');
    if (entry.state === 'failed') throw entry.error;
    return entry.value;
  }
  symbol(source, { trusted = false, publicCore = false, decode = false } = {}) {
    if (typeof source !== 'string' || !source.startsWith('#')) throw Error('invalid Symbol syntax');
    const name = source.slice(1).normalize('NFC');
    if (!name || name.length > 64 || /[\u0000-\u001F\u007F]/u.test(name)) throw Error('invalid Symbol key');
    if (source !== '#' + name) throw Error('Symbol key must be NFC');
    if (publicCore && !trusted) throw Error('untrusted Symbol publication');
    if (!this.#symbols.has(name)) {
      if (decode || !trusted) throw Error('Symbol lookup only');
      if (this.#symbols.size >= this.maxSymbols) throw Error('Symbol budget exceeded');
      this.#symbols.set(name, Object.freeze({ tag: 'Symbol', domain: this.domain, name }));
    }
    if (publicCore) this.#public.add(name);
    if (!trusted && !this.#public.has(name)) throw Error('hidden Symbol');
    return this.#symbols.get(name);
  }
}

function immutableCopy(value, seen = new WeakSet(), budget = { count: 0 }) {
  if (++budget.count > 128) throw Error('snapshot budget exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('non-finite numeric snapshot');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 65536) throw Error('string snapshot budget exceeded');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Array.isArray(value))
    throw Error('non-immutable snapshot');
  seen.add(value);
  const out = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype')
      throw Error('unsafe property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      throw Error('unsafe accessor or hidden property');
    Object.defineProperty(out, key, { value: immutableCopy(descriptor.value, seen, budget), enumerable: true });
  }
  seen.delete(value);
  return Object.freeze(out);
}

class SharedRegionModel {
  #domain; #owner; #active = new Map(); #queue = []; #used = new WeakSet(); #grants = new WeakSet();
  #epoch = 1; #closed = false; #maxQueue; #value; #readers = 0; #writer = false;
  constructor(domain, owner, initial, maxQueue = 4) {
    if (!domain.valid(owner)) throw Error('owner must be runtime-minted');
    if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) throw Error('invalid queue budget');
    this.#domain = domain; this.#owner = owner; this.#value = immutableCopy(initial); this.#maxQueue = maxQueue;
  }
  get physicallyRetired() { return this.#closed && this.#active.size === 0 && this.#queue.length === 0; }
  get pending() { return this.#queue.length; }
  get activeReaders() { return this.#readers; }
  get activeWriters() { return Number(this.#writer); }
  delegate(owner, principal, mode) {
    if (this.#closed || owner !== this.#owner || !this.#domain.valid(principal) || !['read', 'write'].includes(mode))
      throw Error('unauthorized delegation');
    const grant = Object.freeze({ principal, mode, epoch: this.#epoch, region: this });
    this.#grants.add(grant);
    return grant;
  }
  acquire(principal, grant, signal) {
    if (this.#closed || !this.#domain.valid(principal) || !grant || grant.region !== this
        || grant.principal !== principal || grant.epoch !== this.#epoch || !this.#grants.has(grant) || this.#used.has(grant)
        || (grant.mode !== 'read' && grant.mode !== 'write'))
      return Promise.reject(Error('stale or forged grant'));
    if (signal?.aborted) return Promise.reject(Error('loan cancelled'));
    if (this.#active.has(principal) || this.#queue.some(x => x.principal === principal))
      return Promise.reject(Error('recursive logical execution loan'));
    const immediate = this.#queue.length === 0 && this.#canGrant(grant.mode);
    if (!immediate && this.#queue.length >= this.#maxQueue) return Promise.reject(Error('bounded queue full'));
    this.#used.add(grant); // failed admission never burns grant
    if (immediate) return Promise.resolve(this.#grant(principal, grant.mode));
    return new Promise((resolve, reject) => {
      const settle = (fn, value) => { signal?.removeEventListener('abort', cancel); fn(value); };
      const waiter = { principal, mode: grant.mode, resolve: value => settle(resolve, value), reject: error => settle(reject, error) };
      const cancel = () => {
        const index = this.#queue.indexOf(waiter);
        if (index !== -1) {
          this.#queue.splice(index, 1);
          waiter.reject(Error('loan cancelled'));
          this.#promote();
        }
      };
      this.#queue.push(waiter);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  #canGrant(mode) { return !this.#writer && (mode === 'read' || this.#readers === 0); }
  #grant(principal, mode) {
    if (!this.#canGrant(mode)) throw Error('overlap');
    if (mode === 'read') this.#readers++; else this.#writer = true;
    const epoch = this.#epoch;
    const record = { mode, epoch };
    this.#active.set(principal, record);
    let released = false;
    const check = caller => {
      if (released || caller !== principal || this.#closed || this.#epoch !== epoch
          || this.#active.get(principal) !== record) throw Error('stale or foreign loan');
    };
    return Object.freeze({
      read: caller => { check(caller); return immutableCopy(this.#value); },
      write: (caller, change) => {
        check(caller);
        if (mode !== 'write') throw Error('write requires exclusive loan');
        // Transactionally snapshot before invoking a synchronous callback.
        const copy = structuredClone(this.#value);
        const outcome = change(copy);
        if (outcome && typeof outcome.then === 'function') throw Error('await under write loan denied');
        const next = immutableCopy(copy);
        if (this.#closed || epoch !== this.#epoch) throw Error('STOP fenced publication');
        this.#value = next;
      },
      release: caller => {
        if (caller !== principal) throw Error('foreign release');
        if (released) return;
        released = true;
        this.#active.delete(principal);
        if (mode === 'read') this.#readers--; else this.#writer = false;
        this.#promote();
      }
    });

  }
  #promote() {
    if (this.#closed || this.#writer) return;
    while (this.#queue.length) {
      const head = this.#queue[0];
      if (!this.#canGrant(head.mode)) return;
      this.#queue.shift();
      head.resolve(this.#grant(head.principal, head.mode));
      if (head.mode === 'write') return;
    }
  }
  transferOwner(owner, successor) {
    if (this.#closed || owner !== this.#owner || !this.#domain.valid(successor) || this.#active.size || this.#queue.length)
      throw Error('owner transfer requires quiescence');
    this.#owner = successor; this.#epoch++;
  }
  stop(owner) {
    if (owner !== this.#owner) throw Error('only owner may STOP');
    this.#closed = true; this.#epoch++;
    for (const waiter of this.#queue.splice(0)) waiter.reject(Error('STOP revoked queued loan'));
  }
}

test('canonical singleton across slices and actors; sticky failure and cycle', () => {
  const d = new DomainModel('tenant-A');
  let calls = 0;
  const a = d.singleton('pkg', 'Config', () => { calls++; return { nested: { enabled: true } }; });
  const b = d.singleton('pkg', 'Config', () => { calls++; return { nested: { enabled: false } }; });
  assert.strictEqual(a, b); assert.equal(calls, 1); assert.equal(a.nested.enabled, true);
  assert.throws(() => { a.nested.enabled = false; }, TypeError);
  assert.notStrictEqual(a, new DomainModel('tenant-B').singleton('pkg', 'Config', () => ({ nested: { enabled: true } })));
  const err = Error('init failed');
  assert.throws(() => d.singleton('pkg', 'Bad', () => { throw err; }), e => e === err);
  assert.throws(() => d.singleton('pkg', 'Bad', () => 10), e => e === err);
  assert.throws(() => d.singleton('pkg', 'Cycle', () => d.singleton('pkg', 'Cycle', () => 1)), /cycle/);
});

test('reader cohort, queued writer, late reader, and writer exclusivity', async () => {
  const d = new DomainModel('tenant-A');
  const principals = Array.from({ length: 4 }, (_, i) => d.mintPrincipal(i + 1, 1));
  const r = new SharedRegionModel(d, principals[0], { count: 0 });
  const grant = (i, mode) => r.delegate(principals[0], principals[i], mode);
  const a = await r.acquire(principals[0], grant(0, 'read'));
  const b = await r.acquire(principals[1], grant(1, 'read'));
  assert.equal(r.activeReaders, 2);
  const writer = r.acquire(principals[2], grant(2, 'write'));
  const late = r.acquire(principals[3], grant(3, 'read'));
  assert.equal(r.pending, 2);
  a.release(principals[0]); b.release(principals[1]);
  const w = await writer;
  assert.equal(r.activeWriters, 1); assert.equal(r.pending, 1);
  w.write(principals[2], x => { x.count += 1; });
  await assert.rejects(async () => w.write(principals[2], async x => { x.count = 999; }), /await/);
  assert.equal(w.read(principals[2]).count, 1);
  w.release(principals[2]);
  const c = await late;
  assert.equal(c.read(principals[3]).count, 1);
  assert.equal(r.activeReaders, 1); c.release(principals[3]);
});

test('forgery, queue overflow, failed-admission grant reuse, and owner fencing', async () => {
  const d = new DomainModel('tenant-A');
  const owner = d.mintPrincipal(1, 1), reader = d.mintPrincipal(2, 1), next = d.mintPrincipal(3, 1);
  const r = new SharedRegionModel(d, owner, { x: 1 }, 0);
  const w = await r.acquire(owner, r.delegate(owner, owner, 'write'));
  const grant = r.delegate(owner, reader, 'read');
  await assert.rejects(r.acquire(reader, grant), /queue full/);
  assert.throws(() => r.delegate({}, reader, 'read'), /unauthorized/);
  await assert.rejects(r.acquire(Object.freeze({ actor: 2, incarnation: 1, domain: d.domain }), grant), /forged/);
  await assert.rejects(r.acquire(reader, { ...grant }), /forged/);
  assert.throws(() => r.transferOwner(owner, next), /quiescence/);
  w.release(owner);
  const read = await r.acquire(reader, grant); // denial did not burn the token
  assert.equal(read.read(reader).x, 1);
  assert.throws(() => read.release(owner), /foreign/);
  read.release(reader);
  r.transferOwner(owner, next);
  await assert.rejects(r.acquire(reader, grant), /stale/);
  r.stop(next);
  assert.equal(r.physicallyRetired, true);
});

test('STOP fences new loans, revokes queued requests, and retains active physical pins', async () => {
  const d = new DomainModel('tenant-A');
  const owner = d.mintPrincipal(1, 1), queued = d.mintPrincipal(2, 1);
  const r = new SharedRegionModel(d, owner, { value: 7 });
  const w = await r.acquire(owner, r.delegate(owner, owner, 'write'));
  const p = r.acquire(queued, r.delegate(owner, queued, 'read'));
  r.stop(owner);
  await assert.rejects(p, /STOP/);
  assert.equal(r.physicallyRetired, false);
  assert.throws(() => w.write(owner, x => { x.value = 8; }), /stale/);
  assert.throws(() => w.read(owner), /stale/);
  w.release(owner);
  assert.equal(r.physicallyRetired, true);
});

test('bounded canonical #symbols, NFC validation, lookup-only and hidden transport', () => {
  const d = new DomainModel('tenant-A', { maxSymbols: 2 });
  const ready = d.symbol('#ready', { trusted: true, publicCore: true });
  assert.strictEqual(ready, d.symbol('#ready', { decode: true }));
  assert.notEqual(ready, '#ready');
  d.symbol('#private', { trusted: true });
  assert.throws(() => d.symbol('#private', { decode: true }), /hidden/);
  assert.throws(() => d.symbol('#unseen', { decode: true }), /lookup only/);
  assert.throws(() => d.symbol('#overflow', { trusted: true }), /budget/);
  assert.throws(() => d.symbol('#e\u0301', { trusted: true }), /NFC/);
  assert.notStrictEqual(ready, new DomainModel('tenant-B').symbol('#ready', { trusted: true, publicCore: true }));
});

test('cancelled waiter cannot starve a following reader or resurrect its loan', async () => {
  const d = new DomainModel('tenant-A');
  const [owner, writer, late] = [1, 2, 3].map(i => d.mintPrincipal(i, 1));
  const r = new SharedRegionModel(d, owner, { x: 1 });
  const loan = await r.acquire(owner, r.delegate(owner, owner, 'read'));
  const aborter = new AbortController();
  const pendingWriter = r.acquire(writer, r.delegate(owner, writer, 'write'), aborter.signal);
  const pendingReader = r.acquire(late, r.delegate(owner, late, 'read'));
  aborter.abort();
  await assert.rejects(pendingWriter, /cancelled/);
  const second = await pendingReader;
  assert.equal(second.read(late).x, 1);
  second.release(late); loan.release(owner);
  assert.equal(r.pending, 0);
});

test('snapshot rejects accessor side effects, symbol-key smuggling and unbounded input', () => {
  const d = new DomainModel('tenant-A');
  let sideEffects = 0;
  const malicious = Object.defineProperty({}, 'x', { enumerable: true, get() { sideEffects++; return 1; } });
  assert.throws(() => d.singleton('pkg', 'Getter', () => malicious), /unsafe accessor/);
  assert.equal(sideEffects, 0);
  assert.throws(() => d.singleton('pkg', 'SymbolKey', () => ({ [Symbol('cap')]: 1 })), /unsafe property/);
  assert.throws(() => d.singleton('pkg', 'Huge', () => ({ value: 'x'.repeat(65537) })), /budget/);
  assert.throws(() => d.singleton('pkg', 'Nan', () => ({ value: NaN })), /non-finite/);
  assert.throws(() => { d.domain = 'foreign'; }, TypeError);
  assert.throws(() => { d.maxSymbols = 1e9; }, TypeError);
});
