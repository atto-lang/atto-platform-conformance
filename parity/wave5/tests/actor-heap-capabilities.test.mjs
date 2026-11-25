import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadActorHeapCapabilities,
  validateActorHeapCapabilities
} from '../src/actor-heap-capabilities.mjs';

test('actor heap ledger keeps host arenas distinct from compiled guest heap parity', async () => {
  const doc = await loadActorHeapCapabilities();
  const result = validateActorHeapCapabilities(doc);
  assert.equal(result.semanticReady, false);
  assert.equal(result.zeroGcAotReady, false);
  assert.deepEqual(result.backendLevels, {
    java: 'host-runtime',
    llvm: 'compiled-scalar',
    net: 'host-runtime',
    forge: 'host-runtime',
    wasm: 'host-runtime'
  });
  assert.equal(doc.certifiedSemanticActorHeapParity, false);
  assert.equal(doc.certifiedZeroGcFullAotParity, false);
});

test('host helper cannot promote itself to compiled general actor heap', async () => {
  const original = await loadActorHeapCapabilities();
  for (const backend of ['java', 'net', 'forge', 'wasm']) {
    const doc = structuredClone(original);
    const entry = doc.backends.find(value => value.backend === backend);
    entry.generalGuestHeap = true;
    assert.throws(() => validateActorHeapCapabilities(doc), /general guest heap/);
  }
});

test('full AOT cannot be inferred from host-runtime arena execution', async () => {
  const original = await loadActorHeapCapabilities();
  const doc = structuredClone(original);
  doc.backends.find(value => value.backend === 'forge').aotLevel = 'full-aot';
  assert.throws(() => validateActorHeapCapabilities(doc), /full AOT cannot be inferred/);
});

test('general zero-GC claim requires compiled-general deterministic full AOT', async () => {
  const original = await loadActorHeapCapabilities();
  for (const mutation of [
    entry => { entry.zeroGcClaim = 'guest-general'; },
    entry => {
      entry.allocationLevel = 'compiled-general';
      entry.generalGuestHeap = true;
      entry.zeroGcClaim = 'guest-general';
      entry.aotLevel = 'full-aot';
      entry.reclamation = 'gc-dependent';
    }
  ]) {
    const doc = structuredClone(original);
    mutation(doc.backends.find(value => value.backend === 'llvm'));
    assert.throws(() => validateActorHeapCapabilities(doc), /general zero-GC claim/);
  }
});

test('LLVM scalar zero-GC status is intentionally narrower than general heap parity', async () => {
  const original = await loadActorHeapCapabilities();
  const llvm = original.backends.find(value => value.backend === 'llvm');
  assert.equal(llvm.allocationLevel, 'compiled-scalar');
  assert.equal(llvm.zeroGcClaim, 'compiled-scalar-only');
  assert.equal(llvm.generalGuestHeap, false);
  assert.equal(llvm.verified, true);
});

test('semantic parity cannot be toggled without every verified compiled-general backend', async () => {
  const original = await loadActorHeapCapabilities();
  const doc = structuredClone(original);
  doc.certifiedSemanticActorHeapParity = true;
  assert.throws(() => validateActorHeapCapabilities(doc), /semantic parity flag/);
});

test('zero-GC full-AOT parity cannot be toggled as a documentation assertion', async () => {
  const original = await loadActorHeapCapabilities();
  const doc = structuredClone(original);
  doc.certifiedZeroGcFullAotParity = true;
  assert.throws(() => validateActorHeapCapabilities(doc), /zero-GC\/full-AOT flag/);
});

test('self-attested complete evidence cannot certify a candidate manifest', async () => {
  const original = await loadActorHeapCapabilities();
  const doc = structuredClone(original);
  for (const entry of doc.backends) {
    entry.allocationLevel = 'compiled-general';
    entry.generalGuestHeap = true;
    entry.reclamation = 'deterministic-native';
    entry.aotLevel = 'full-aot';
    entry.zeroGcClaim = 'guest-general';
    entry.verified = true;
  }
  doc.certifiedSemanticActorHeapParity = true;
  doc.certifiedZeroGcFullAotParity = true;
  assert.throws(() => validateActorHeapCapabilities(doc), /candidate (?:row )?may not self-certify/);
});

test('promotion requirements cannot be silently weakened or reordered', async () => {
  const original = await loadActorHeapCapabilities();
  for (const mutation of [
    doc => { doc.promotionRequirements[0] = 'all backends self-report success'; },
    doc => { doc.promotionRequirements.reverse(); },
    doc => { doc.promotionRequirements.push('optional extra gate'); }
  ]) {
    const doc = structuredClone(original);
    mutation(doc);
    assert.throws(() => validateActorHeapCapabilities(doc), /promotion requirements missing, reordered or weakened/);
  }
});


test('one backend cannot self-certify compiled-general inside candidate ledger', async () => {
  const original = await loadActorHeapCapabilities();
  for (const mutation of [
    entry => {
      entry.allocationLevel = 'compiled-general';
      entry.generalGuestHeap = true;
      entry.reclamation = 'deterministic-native';
      entry.verified = true;
    },
    entry => {
      entry.allocationLevel = 'compiled-general';
      entry.generalGuestHeap = true;
      entry.reclamation = 'deterministic-native';
      entry.aotLevel = 'full-aot';
      entry.verified = true;
    },
    entry => {
      entry.allocationLevel = 'compiled-general';
      entry.generalGuestHeap = true;
      entry.reclamation = 'deterministic-native';
      entry.aotLevel = 'full-aot';
      entry.zeroGcClaim = 'guest-general';
      entry.verified = true;
    }
  ]) {
    const doc = structuredClone(original);
    mutation(doc.backends.find(value => value.backend === 'java'));
    assert.throws(
      () => validateActorHeapCapabilities(doc),
      /candidate row may not self-certify general\/full-AOT claims/
    );
  }
});
