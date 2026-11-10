import test from 'node:test';
import assert from 'node:assert/strict';

// SOURCE-FREE reference oracle only. Does not execute private compiler/runtime
// source or certify a compiled AttoLang actor, AOT, native RSS, or isolation.
class HeapModel {
  constructor(limit, slots = 4) {
    this.limit = limit;
    this.bytes = new Uint8Array(limit);
    this.cursor = 0;
    this.live = 0;
    this.slots = Array.from({length: slots}, () =>
      ({offset: 0, length: 0, span: 0, generation: 1, live: false}));
  }
  allocate(length, alignment = 8) {
    if (!Number.isSafeInteger(length) || length < 1 ||
        !Number.isSafeInteger(alignment) || alignment < 8 ||
        alignment > 64 || (alignment & (alignment - 1))) return null;
    const offset = Math.ceil(this.cursor / alignment) * alignment;
    let free = -1, reusable = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.live || s.generation === 0xffffffff) continue;
      if (free < 0) free = i;
      if (s.span >= length && s.offset + s.span <= this.cursor &&
          s.offset % alignment === 0) { reusable = i; break; }
    }
    if (reusable >= 0) free = reusable;
    if (free < 0 || (reusable < 0 && (offset > this.limit ||
        length > this.limit - offset))) return null;
    const s = this.slots[free];
    const start = reusable >= 0 ? s.offset : offset;
    this.bytes.fill(0, start, start + length);
    s.offset = start;
    s.length = length;
    if (reusable < 0) s.span = length;
    s.live = true;
    if (reusable < 0) this.cursor = start + length;
    this.live++;
    return Object.freeze({word: start / 8 + 1, slot: free,
      generation: s.generation});
  }
  slot(handle) {
    if (!handle || handle.slot < 0 || handle.slot >= this.slots.length)
      throw new Error('invalid actor handle');
    const s = this.slots[handle.slot];
    if (!s.live || s.generation !== handle.generation ||
        s.offset / 8 + 1 !== handle.word)
      throw new Error('stale actor handle');
    return s;
  }
  read(handle) { const s = this.slot(handle); return this.bytes[s.offset]; }
  write(handle, value) { const s = this.slot(handle); this.bytes[s.offset] = value; }
  drop(handle) {
    const s = this.slot(handle);
    this.bytes.fill(0, s.offset, s.offset + s.span);
    s.live = false;
    s.generation++;
    this.live--;
    if (!this.live) {
      this.bytes.fill(0, 0, this.cursor);
      this.cursor = 0;
      for (const dead of this.slots) if (!dead.live) dead.span = 0;
    }
  }
}

test('10k temporary allocations reuse a scrubbed hole under a persistent root at hard quota', () => {
  const h = new HeapModel(256, 3);
  const root = h.allocate(8);
  h.write(root, 42);
  let temporary = h.allocate(248);
  assert.equal(h.cursor, 256);
  h.drop(temporary);
  for (let i = 0; i < 10_000; i++) {
    const stale = temporary;
    temporary = h.allocate(248);
    assert.ok(temporary);
    assert.equal(temporary.word, 2);
    assert.equal(h.read(temporary), 0);
    assert.throws(() => h.read(stale), /stale/);
    assert.equal(h.read(root), 42);
    h.write(temporary, 99);
    h.drop(temporary);
  }
  assert.equal(h.cursor, 256);
  assert.equal(h.live, 1);
});

test('recycled span maintains alignment and never aliases an appended live allocation', () => {
  const h = new HeapModel(384);
  const root = h.allocate(8);
  const old = h.allocate(64, 64);
  assert.equal(old.word, 9);
  h.drop(old);
  const smaller = h.allocate(16, 64);
  assert.equal(smaller.word, 9);
  const neighbor = h.allocate(64);
  assert.equal(neighbor.word, 17);
  h.write(neighbor, 92);
  h.drop(smaller);
  assert.equal(h.read(neighbor), 92);
  assert.throws(() => h.read(old), /stale/);
  h.drop(neighbor); h.drop(root);
});

test('last-owner reset invalidates cached hole metadata but retains generations', () => {
  const h = new HeapModel(384);
  const first = h.allocate(8);
  const old = h.allocate(64, 64);
  h.drop(old); h.drop(first);
  assert.equal(h.cursor, 0);
  const next = h.allocate(8);
  assert.equal(next.word, 1);
  assert.notEqual(next.generation, first.generation);
  const aligned = h.allocate(64, 64);
  assert.equal(aligned.word, 9);
  assert.throws(() => h.read(old), /stale/);
});

test('incompatible hole alignment and over-quota attempts do not publish partial allocations', () => {
  const h = new HeapModel(72, 3);
  const root = h.allocate(8);
  const tail = h.allocate(64);
  h.write(root, 8);
  h.drop(tail);
  const bad = h.allocate(64, 64);
  assert.equal(bad, null);
  assert.equal(h.cursor, 72);
  assert.equal(h.live, 1);
  assert.equal(h.read(root), 8);
  const admitted = h.allocate(64, 8);
  assert.ok(admitted);
  assert.equal(h.read(admitted), 0);
});
