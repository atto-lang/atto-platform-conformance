import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspect_strict_aot_inventory } from '../lib/strict-guest-aot-lanes-v1.mjs';

const path = fileURLToPath(new URL('../contracts/strict-guest-aot-lanes-v1.json', import.meta.url));
const load = async () => JSON.parse(await readFile(path, 'utf8'));
const clone = (m) => JSON.parse(JSON.stringify(m));

test('all sixteen native target lanes remain explicit and unattested', async () => {
  const m = await load();
  assert.deepEqual(inspect_strict_aot_inventory(m), {
    status:'INVENTORY_VALID_UNATTESTED', nativeLanes:16,
    verifiedNativeLanes:0, wasmProducts:2, releaseReady:false
  });
  assert.equal(new Set(m.lanes.map(x => x.id)).size, 16);
  assert.ok(m.lanes.every(x => x.receipt === null && x.status === 'NOT_EXECUTED'));
});

test('missing, duplicated or reordered native lanes are not silently accepted', async () => {
  const m = await load();
  for (const change of [
    x => x.lanes.pop(),
    x => { x.lanes[1] = x.lanes[0]; },
    x => { [x.lanes[0], x.lanes[1]] = [x.lanes[1], x.lanes[0]]; },
    x => { x.lanes[0].backend = 'wasm'; },
    x => { x.lanes[0].artifactFormat = 'wasm-module'; },
    x => { x.lanes[0].mode = 'interpreter-native-image'; },
    x => { x.lanes[0].status = 'PASS'; },
    x => { x.lanes[0].receipt = { passed:true }; },
  ]) {
    const input = clone(m); change(input);
    assert.throws(() => inspect_strict_aot_inventory(input));
  }
});

test('Wasm packaging must not masquerade as native guest lanes', async () => {
  const m = await load();
  for (const [change, code] of [
    [x => { x.wasmProducts.pop(); }, 'invalid-wasm-products'],
    [x => { x.wasmProducts[0].id = 'native-exe'; }, 'invalid-wasm-product'],
    [x => { x.wasmProducts[1].status = 'PASS'; }, 'invalid-wasm-product'],
    [x => { x.wasmProducts[1].proof = ''; }, 'invalid-wasm-product']
  ]) { const input = clone(m); change(input); assert.throws(
    () => inspect_strict_aot_inventory(input), { code }
  ); }
});

test('unknown fields, reordered backend dimensions and release-ready spoofing reject', async () => {
  const m = await load();
  for (const change of [
    x => { x.releaseReady = true; },
    x => { x.lanes[0].signature = 'fake'; },
    x => { x.status = 'VERIFIED'; },
    x => { x.backends.reverse(); },
    x => { x.requiredCases = ['guest-return-42']; },
    x => { x.signedArtifactDependency = 'none'; },
  ]) { const input = clone(m); change(input); assert.throws(
    () => inspect_strict_aot_inventory(input)
  ); }
});
