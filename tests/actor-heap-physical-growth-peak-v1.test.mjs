import test from 'node:test';
import assert from 'node:assert/strict';

// Source-free accounting reference only. No compiled AttoLang actor, .NET
// NativeAOT, JVM, LLVM, Wasm guest, Forge, Rust or Cranelift backend runs here.
class Ledger {
  constructor(limit) { this.limit = limit; this.used = 0; }
  charge(n) {
    if (!Number.isSafeInteger(n) || n <= 0 || n > this.limit - this.used)
      return false;
    this.used += n;
    return true;
  }
  refund(n) {
    assert.ok(Number.isSafeInteger(n) && n >= 0 && n <= this.used);
    this.used -= n;
  }
}

class RelocatingHeapReference {
  constructor(hardLimit, tenant, process) {
    this.hardLimit = hardLimit;
    this.tenant = tenant;
    this.process = process;
    this.bytes = new Uint8Array(0);
    this.committed = 0;
  }
  grow(required, injectNativeFailure = false) {
    if (!Number.isSafeInteger(required) || required < 0 ||
        required > this.hardLimit) return false;
    if (required <= this.committed) return true;
    let next = this.committed || Math.min(this.hardLimit, 4096);
    while (next < required) next = Math.min(this.hardLimit, next * 2);
    // Both blocks are live until the old one is scrubbed and freed.
    if (!this.tenant.charge(next)) return false;
    if (!this.process.charge(next)) {
      this.tenant.refund(next);
      return false;
    }
    let replacement;
    try {
      if (injectNativeFailure) throw new Error('injected native failure');
      replacement = new Uint8Array(next);
      replacement.set(this.bytes);
    } catch {
      replacement?.fill(0);
      this.process.refund(next);
      this.tenant.refund(next);
      return false;
    }
    const old = this.bytes;
    const oldCommitted = this.committed;
    this.bytes = replacement;
    this.committed = next;
    old.fill(0);
    this.process.refund(oldCommitted);
    this.tenant.refund(oldCommitted);
    return true;
  }
  retire() {
    this.bytes.fill(0);
    this.tenant.refund(this.committed);
    this.process.refund(this.committed);
    this.committed = 0;
    this.bytes = new Uint8Array(0);
  }
}

test('a 4 KiB to 8 KiB relocation requires 12 KiB peak tenant and process budget', () => {
  const tenant = new Ledger(8192), process = new Ledger(12288);
  const actor = new RelocatingHeapReference(8192, tenant, process);
  assert.equal(actor.grow(4096), true);
  actor.bytes[0] = 42;
  assert.equal(actor.grow(8192), false);
  assert.equal(actor.committed, 4096);
  assert.equal(actor.bytes[0], 42);
  assert.equal(tenant.used, 4096);
  assert.equal(process.used, 4096);
  actor.retire();
  assert.equal(tenant.used, 0);
  assert.equal(process.used, 0);
});

test('old backing is refunded after success and failure is accounting neutral', () => {
  const tenant = new Ledger(12288), process = new Ledger(12288);
  const actor = new RelocatingHeapReference(8192, tenant, process);
  assert.equal(actor.grow(4096), true);
  actor.bytes[123] = 71;
  assert.equal(actor.grow(8192, true), false);
  assert.equal(actor.committed, 4096);
  assert.equal(actor.bytes[123], 71);
  assert.equal(tenant.used, 4096);
  assert.equal(process.used, 4096);
  assert.equal(actor.grow(8192), true);
  assert.equal(actor.bytes[123], 71);
  assert.equal(actor.bytes[7000], 0);
  assert.equal(actor.committed, 8192);
  assert.equal(tenant.used, 8192);
  assert.equal(process.used, 8192);
  actor.retire();
  assert.equal(tenant.used, 0);
  assert.equal(process.used, 0);
});

test('a sibling physical reservation cannot be bypassed by a relocating actor', () => {
  const tenant = new Ledger(16384), process = new Ledger(16384);
  const a = new RelocatingHeapReference(8192, tenant, process);
  const b = new RelocatingHeapReference(8192, tenant, process);
  assert.equal(a.grow(4096), true);
  assert.equal(b.grow(4096), true);
  b.bytes[1] = 99;
  assert.equal(a.grow(8192), true); // 4 + 4 + 8 = 16 KiB transient
  assert.equal(b.grow(8192), false); // 8 + 4 + 8 > 16 KiB transient
  assert.equal(b.bytes[1], 99);
  assert.equal(tenant.used, 12288);
  assert.equal(process.used, 12288);
  a.retire(); b.retire();
  assert.equal(process.used, 0);
  assert.equal(tenant.used, 0);
});
