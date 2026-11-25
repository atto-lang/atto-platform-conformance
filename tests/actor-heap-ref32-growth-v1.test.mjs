import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A source-free ABI reference model. These tests do not execute an AttoLang
// compiler, Native Image, LLVM binary, or .NET NativeAOT executable.
const contract = JSON.parse(readFileSync(
  new URL('../contracts/actor-heap-ref32-growth-v1.json', import.meta.url), 'utf8'));
const maxWord = 0xffff_ffffn;
const largestOffset = (maxWord - 1n) * 8n;

function encodeRef32(byteOffset) {
  if (typeof byteOffset !== 'bigint' || byteOffset < 0n || byteOffset % 8n !== 0n ||
      byteOffset > largestOffset) throw new RangeError('invalid actor-relative object start');
  return Number(byteOffset / 8n + 1n);
}
function decodeRef32(word) {
  if (!Number.isInteger(word) || word < 0 || word > Number(maxWord))
    throw new RangeError('invalid unsigned 32-bit word');
  return word === 0 ? null : (BigInt(word) - 1n) * 8n;
}
class ActorHeapModel {
  constructor(actor, generation, quota, budget) {
    this.actor = actor;
    this.generation = generation;
    this.quota = quota;
    this.budget = budget;
    this.committed = 0;
    this.cursor = 0;
    this.live = new Map();
    this.retired = false;
  }
  allocate(bytes) {
    if (this.retired || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
    const offset = Math.ceil(this.cursor / 8) * 8;
    if (offset + bytes > this.quota) return null;
    const oldCommitted = this.committed;
    const extra = Math.max(0, offset + bytes - oldCommitted);
    if (this.budget.reserved + extra > this.budget.max) return null;
    this.budget.reserved += extra;
    this.committed += extra;
    this.cursor = offset + bytes;
    const word = encodeRef32(BigInt(offset));
    this.live.set(word, { value: 0, generation: this.generation });
    return { word, actor: this.actor, generation: this.generation };
  }
  read(ref) {
    if (this.retired || ref.actor !== this.actor || ref.generation !== this.generation)
      throw new Error('foreign or stale actor authority');
    const slot = this.live.get(ref.word);
    if (!slot || slot.generation !== this.generation)
      throw new Error('invalid published object start');
    return slot.value;
  }
  write(ref, value) { this.read(ref); this.live.get(ref.word).value = value; }
  retire() {
    if (this.retired) return;
    this.retired = true;
    this.live.clear();
    this.budget.reserved -= this.committed;
    this.committed = 0;
  }
}

test('contract pins 32-bit actor-relative words, not native host addresses', () => {
  assert.equal(contract.references.wordBits, 32);
  assert.equal(contract.references.nullWord, 0);
  assert.equal(contract.references.objectAlignmentBytes, 8);
  assert.equal(contract.references.wordAloneIsAuthority, false);
  assert.equal(contract.references.nativeFfiPointersCompressed, false);
  assert.equal(contract.references.actorRefsCompressed, false);
  assert.equal(contract.references.generationInWord, false);
  assert.deepEqual(contract.targets, ['java-graalvm', 'llvm', 'net-nativeaot']);
});

test('unsigned ref32 boundaries include high-bit words and do not sign extend', () => {
  for (const word of [1, 2, 0x7fff_ffff, 0x8000_0000, 0xffff_fffe, 0xffff_ffff]) {
    const offset = decodeRef32(word);
    assert.equal(encodeRef32(offset), word);
  }
  assert.equal(decodeRef32(0), null);
  assert.equal(decodeRef32(1), 0n);
  assert.equal(decodeRef32(0xffff_ffff), 34_359_738_352n);
  assert.equal(encodeRef32(34_359_738_352n), 0xffff_ffff);
  assert.notEqual(encodeRef32(8n), encodeRef32(16n));
  assert.equal(contract.references.largestOffsetBytes, String(largestOffset));
});

for (const bad of [-1, 1.5, 0x1_0000_0000, NaN, Infinity, '1', 1n]) {
  test(`reject non-u32 encoded word ${String(bad)}`, () => {
    assert.throws(() => decodeRef32(bad), RangeError);
  });
}
for (const bad of [-8n, 1n, 7n, largestOffset + 8n, 8, '8']) {
  test(`reject misaligned, out-of-range or non-bigint byte offset ${String(bad)}`, () => {
    assert.throws(() => encodeRef32(bad), RangeError);
  });
}

test('two actors may reuse word 1 without sharing a heap or authority', () => {
  const budget = { max: 128, reserved: 0 };
  const a = new ActorHeapModel('a', 1, 64, budget);
  const b = new ActorHeapModel('b', 2, 64, budget);
  const ra = a.allocate(8), rb = b.allocate(8);
  assert.equal(ra.word, rb.word);
  a.write(ra, 41); b.write(rb, 72);
  assert.equal(a.read(ra), 41); assert.equal(b.read(rb), 72);
  assert.throws(() => a.read(rb), /foreign/);
  a.retire(); assert.equal(b.read(rb), 72);
  assert.equal(budget.reserved, 8);
  b.retire(); assert.equal(budget.reserved, 0);
});

test('growth, quota failure and aggregate-budget failure preserve live data', () => {
  const budget = { max: 32, reserved: 0 };
  const a = new ActorHeapModel('a', 7, 64, budget);
  const root = a.allocate(8);
  assert.equal(a.committed, 8);
  a.write(root, 900);
  const next = a.allocate(16);
  assert.equal(a.committed, 24);
  assert.equal(a.read(root), 900);
  assert.equal(a.allocate(16), null);
  assert.equal(a.read(root), 900);
  assert.equal(a.committed, 24);
  assert.equal(budget.reserved, 24);
  assert.equal(a.allocate(100), null);
  a.retire(); assert.equal(budget.reserved, 0);
  assert.throws(() => a.read(root), /stale/);
  assert.equal(a.allocate(8), null);
  assert.equal(next.word, 2);
});

test('dynamic and prefault realtime profiles are separate, both enforce authority', () => {
  assert.deepEqual(contract.allocation.profiles, ['dynamic', 'realtime-prefault']);
  assert.equal(contract.allocation.dynamicCommitOnDemand, true);
  assert.equal(contract.allocation.realtimePrefaultNeverGrowsDuringActorTurn, true);
  assert.equal(contract.allocation.logicalOffsetsStableAcrossGrowth, true);
  assert.equal(contract.allocation.aggregateProcessTenantBudgetRequired, true);
  assert.equal(contract.security.authenticateTurnAfterCarrierMigration, true);
  assert.equal(contract.security.quarantinePublishedOffsetsUntilSafeReclamation, true);
  assert.equal(contract.security.noCrossActorRawRefTransport, true);
});

test('no host-reference result can claim backend guest or AOT execution', () => {
  for (const name of contract.targets)
    assert.equal(contract.evidence[name], 'NOT_EXECUTED');
  assert.match(contract.evidence.required, /exact-head executed \.atto guest/);
});
