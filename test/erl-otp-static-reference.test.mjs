// Host-only reference semantics for strict-AOT compiler lowering. This deliberately
// does NOT execute AttoLang, certify an AOT artifact, or permit guest JIT.
import test from 'node:test';
import assert from 'node:assert/strict';

function queue({ generation, maxMessages = 32, maxBytes = 1024 }) {
  assert.ok(Number.isSafeInteger(generation) && generation >= 0);
  assert.ok(Number.isSafeInteger(maxMessages) && maxMessages > 0);
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0);
  return { generation, maxMessages, maxBytes, messages: [], bytes: 0, scanIndex: 0, scanTagsKey: null };
}

function admit(q, { sender, tag, generation, bytes }) {
  if (typeof sender !== 'string' || sender.length === 0 ||
      typeof tag !== 'string' || tag.length === 0 ||
      !Number.isSafeInteger(bytes) || bytes < 0) return 'INVALID';
  if (generation !== q.generation) return 'STALE_GENERATION';
  if (q.messages.length >= q.maxMessages || bytes > q.maxBytes - q.bytes) return 'BACKPRESSURE';
  // Admission copies only the immutable descriptor in this model. A real runtime
  // must move/copy the payload and prove its ownership/lifetime independently.
  q.messages.push({ sender, tag, generation, bytes });
  q.bytes += bytes;
  return 'ADMITTED';
}

function receive(q, matchTags, context = {}) {
  // No predicate callbacks, regex, reflection, or runtime code compilation:
  // a real compiler lowers these finite tags to static discriminant checks.
  assert.ok(Array.isArray(matchTags) && matchTags.length > 0);
  assert.ok(matchTags.every(tag => typeof tag === 'string' && tag.length > 0));
  assert.equal(new Set(matchTags).size, matchTags.length);
  const { stopped = false, cancelled = false, now = 0, deadline = Infinity, scanBudget = 64 } = context;
  assert.ok(Number.isSafeInteger(now) && now >= 0);
  assert.ok(deadline === Infinity || (Number.isSafeInteger(deadline) && deadline >= 0));
  assert.ok(Number.isSafeInteger(scanBudget) && scanBudget >= 1 && scanBudget <= 65536);
  if (stopped || cancelled) {
    q.scanIndex = 0;
    q.scanTagsKey = null;
    return { kind: stopped ? 'STOP' : 'CANCELLED' };
  }
  const tagsKey = JSON.stringify([...matchTags].sort());
  if (q.scanTagsKey !== tagsKey) {
    q.scanIndex = 0;
    q.scanTagsKey = tagsKey;
  }
  const tags = new Set(matchTags);
  let scanned = 0;
  for (let i = q.scanIndex; i < q.messages.length; i++) {
    if (scanned === scanBudget) {
      q.scanIndex = i;
      return { kind: 'YIELD', scanned }; // Checkpoint: never monopolize carrier.
    }
    const m = q.messages[i];
    assert.equal(m.generation, q.generation, 'stale descriptor must never be admitted');
    scanned++;
    if (!tags.has(m.tag)) continue;
    q.messages.splice(i, 1); // Exactly one commit; unmatched messages retain order.
    q.bytes -= m.bytes;
    q.scanIndex = 0;
    q.scanTagsKey = null;
    return { kind: 'MATCH', message: m, scanned };
  }
  // A new message appended after a completed scan is examined without
  // rescanning the retained, statically proven nonmatches.
  q.scanIndex = q.messages.length;
  if (now >= deadline) {
    q.scanIndex = 0;
    q.scanTagsKey = null;
    return { kind: 'TIMEOUT' };
  }
  return { kind: 'WAITING' };
}

function readBits(bytes, offsetBits, width, { endian = 'big', signed = false } = {}) {
  assert.ok(bytes instanceof Uint8Array);
  if (!Number.isSafeInteger(offsetBits) || offsetBits < 0 ||
      !Number.isSafeInteger(width) || width < 1 || width > 64) throw new RangeError('invalid bit offset or width');
  if (endian !== 'big' && endian !== 'little') throw new TypeError('unknown endian');
  if (typeof signed !== 'boolean') throw new TypeError('signed flag must be bool');
  if (endian === 'little' && (offsetBits % 8 !== 0 || width % 8 !== 0)) {
    throw new RangeError('little-endian field must be byte aligned');
  }
  // Subtraction avoids offset + width overflow in fixed-width native code.
  const totalBits = bytes.length * 8;
  if (offsetBits > totalBits || width > totalBits - offsetBits) throw new RangeError('short binary');
  let value = 0n;
  if (endian === 'little') {
    for (let i = width / 8 - 1; i >= 0; --i) {
      value = (value << 8n) | BigInt(bytes[offsetBits / 8 + i]);
    }
  } else {
    for (let i = 0; i < width; ++i) {
      const bitIndex = offsetBits + i;
      const bit = (bytes[Math.floor(bitIndex / 8)] >> (7 - bitIndex % 8)) & 1;
      value = (value << 1n) | BigInt(bit);
    }
  }
  if (signed && (value & (1n << BigInt(width - 1)))) value -= 1n << BigInt(width);
  return { value, nextOffsetBits: offsetBits + width };
}

const msg = (sender, tag, bytes = 1, generation = 4) => ({ sender, tag, bytes, generation });

test('selective receive skips unmatched messages, commits one earliest match, preserves other FIFO', () => {
  const q = queue({ generation: 4 });
  for (const m of [msg('a', 'Payment'), msg('b', 'Inventory'), msg('a', 'Shutdown'), msg('a', 'Shutdown')]) {
    assert.equal(admit(q, m), 'ADMITTED');
  }
  assert.deepEqual(receive(q, ['Shutdown'], { now: 0, deadline: 0 }),
    { kind: 'MATCH', message: msg('a', 'Shutdown'), scanned: 3 });
  assert.deepEqual(q.messages.map(m => m.tag), ['Payment', 'Inventory', 'Shutdown']);
  assert.equal(q.bytes, 3);
  assert.equal(receive(q, ['Payment', 'Shutdown']).message.tag, 'Payment');
  assert.deepEqual(q.messages.map(m => m.tag), ['Inventory', 'Shutdown']);
});

test('bounded admission and stale generations fail without mutating queue', () => {
  const q = queue({ generation: 4, maxMessages: 2, maxBytes: 3 });
  assert.equal(admit(q, msg('a', 'A', 2)), 'ADMITTED');
  const before = structuredClone(q);
  assert.equal(admit(q, msg('a', 'B', 2)), 'BACKPRESSURE');
  assert.equal(admit(q, msg('a', 'B', 1, 5)), 'STALE_GENERATION');
  assert.equal(admit(q, msg('a', 'B', -1)), 'INVALID');
  assert.deepEqual(q, before);
  assert.equal(admit(q, msg('a', 'B', 1)), 'ADMITTED');
  assert.equal(admit(q, msg('a', 'C', 0)), 'BACKPRESSURE');
  assert.equal(receive(q, ['A']).message.bytes, 2);
  assert.equal(admit(q, msg('a', 'C', 2)), 'ADMITTED');
});

test('STOP and cancellation leave messages untouched; timeout never consumes unmatched', () => {
  const q = queue({ generation: 4 });
  admit(q, msg('a', 'Payment'));
  const before = structuredClone(q);
  assert.deepEqual(receive(q, ['Payment'], { stopped: true }), { kind: 'STOP' });
  assert.deepEqual(receive(q, ['Payment'], { cancelled: true }), { kind: 'CANCELLED' });
  assert.deepEqual(receive(q, ['Shutdown'], { now: 10, deadline: 10 }), { kind: 'TIMEOUT' });
  assert.deepEqual(q, before);
  assert.equal(receive(q, ['Payment'], { now: 10, deadline: 10 }).kind, 'MATCH');
});

test('binary cursor supports unaligned big-endian fields and signed integers', () => {
  const b = Uint8Array.from([0b10110001, 0xff]);
  assert.deepEqual(readBits(b, 0, 3), { value: 5n, nextOffsetBits: 3 });
  assert.deepEqual(readBits(b, 3, 5), { value: 17n, nextOffsetBits: 8 });
  assert.deepEqual(readBits(b, 1, 3), { value: 3n, nextOffsetBits: 4 });
  assert.deepEqual(readBits(b, 8, 8, { signed: true }), { value: -1n, nextOffsetBits: 16 });
  assert.equal(readBits(Uint8Array.from([0x80]), 0, 1, { signed: true }).value, -1n);
});

test('binary endian decoding is explicit and fails closed on short or invalid fields', () => {
  const b = Uint8Array.from([0x12, 0x34]);
  assert.equal(readBits(b, 0, 16).value, 0x1234n);
  assert.equal(readBits(b, 0, 16, { endian: 'little' }).value, 0x3412n);
  for (const [offset, width, options] of [
    [0, 0, {}], [0, 65, {}], [-1, 2, {}], [1, 16, {}],
    [8, 9, {}], [1, 8, { endian: 'little' }], [0, 3, { endian: 'little' }],
    [0, 8, { endian: 'invalid' }], [Number.MAX_SAFE_INTEGER, 1, {}],
  ]) assert.throws(() => readBits(b, offset, width, options));
  assert.deepEqual(Array.from(b), [0x12, 0x34], 'borrowed binary must not be mutated');
});

test('all 1..64 bit widths preserve unsigned and signed conversion without pointer overflow', () => {
  const b = Uint8Array.from(Array(8).fill(0xff));
  for (let width = 1; width <= 64; width++) {
    assert.equal(readBits(b, 0, width).value, (1n << BigInt(width)) - 1n);
    assert.equal(readBits(b, 0, width, { signed: true }).value, -1n);
    if (width > 1) assert.throws(() => readBits(b, 65 - width, width));
  }
});

test('bounded scanning yields and resumes without reordering or dropping unmatched messages', () => {
  const q = queue({ generation: 4, maxMessages: 128 });
  for (let i = 0; i < 99; i++) assert.equal(admit(q, msg('a', 'Other')), 'ADMITTED');
  assert.equal(admit(q, msg('b', 'Shutdown')), 'ADMITTED');
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(receive(q, ['Shutdown'], { scanBudget: 8 }), { kind: 'YIELD', scanned: 8 });
    assert.equal(q.messages.length, 100);
  }
  assert.equal(receive(q, ['Shutdown'], { scanBudget: 8 }).kind, 'MATCH');
  assert.equal(q.messages.length, 99);
  assert.ok(q.messages.every(m => m.tag === 'Other'));
  // Different tag sets must re-scan from the head rather than reuse an old cursor.
  assert.equal(receive(q, ['Other'], { scanBudget: 8 }).kind, 'MATCH');
});

test('STOP/cancellation preempt budgeted scan and never consume a matching message', () => {
  const q = queue({ generation: 4 });
  for (let i = 0; i < 5; i++) admit(q, msg('a', 'Other'));
  admit(q, msg('a', 'Shutdown'));
  assert.equal(receive(q, ['Shutdown'], { scanBudget: 2 }).kind, 'YIELD');
  const messages = structuredClone(q.messages);
  assert.equal(receive(q, ['Shutdown'], { cancelled: true }).kind, 'CANCELLED');
  assert.deepEqual(q.messages, messages);
  assert.equal(receive(q, ['Shutdown'], { scanBudget: 10 }).kind, 'MATCH');
  assert.equal(q.messages.length, 5);
});
