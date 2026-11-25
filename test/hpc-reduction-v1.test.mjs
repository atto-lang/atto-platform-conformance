import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_TILE_SIZE, MAX_F64_ELEMENTS, planF64Tiles, computeF64TilePartials,
  mergeF64TilePartials, referenceF64Reduction, f64HexBits,
} from '../verification/hpc-reduction-v1.mjs';

const fixtureUrl = new URL('../fixtures/hpc-reduction-v1/vectors.json', import.meta.url);
const arr = values => new Float64Array(values);

test('fixed published numeric vectors match exact IEEE-754 output bits', async () => {
  const vectors = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  assert.equal(vectors.schema, 'atto.hpc-reduction-v1/1');
  assert.equal(vectors.evidence, 'HOST_REFERENCE_ONLY');
  for (const fixture of vectors.cases) {
    const result = referenceF64Reduction(arr(fixture.lhs), {
      rhs: fixture.rhs ? arr(fixture.rhs) : undefined,
      tileSize: fixture.tileSize,
    });
    assert.equal(f64HexBits(result.value), fixture.valueBits, fixture.id);
    assert.equal(result.tiles, fixture.tiles, fixture.id);
  }
});

test('the execution plan is bounded, contiguous and immutable', () => {
  assert.equal(DEFAULT_TILE_SIZE, 256);
  const plan = planF64Tiles(517, 256);
  assert.deepEqual(plan.map(p => [p.tile, p.start, p.end]), [
    [0, 0, 256], [1, 256, 512], [2, 512, 517],
  ]);
  assert.ok(Object.isFrozen(plan));
  for (const tile of plan) assert.ok(Object.isFrozen(tile));
  assert.deepEqual(planF64Tiles(0, 16), []);
});

test('tile scheduling/completion permutations cannot change reduction bits', () => {
  const lhs = arr([1e16, 1, -1e16, 2, 7, -3, 4, 8, 2, -1, 6, 10]);
  const rhs = arr([1, 1, 1, 1, -2, 3, 2, 0.5, 4, 1, 3, 1]);
  for (const operands of [{}, { rhs }]) {
    const base = referenceF64Reduction(lhs, { tileSize: 2, ...operands });
    const plan = planF64Tiles(lhs.length, 2);
    const reversed = [...plan].reverse().map(p => p.tile);
    const interleaved = [1, 4, 0, 3, 5, 2];
    for (const order of [reversed, interleaved]) {
      const parts = computeF64TilePartials(lhs, { tileSize: 2, visitOrder: order, ...operands });
      assert.deepEqual(parts.map(p => p.tile), order);
      assert.equal(f64HexBits(mergeF64TilePartials(plan, parts)), f64HexBits(base.value));
    }
  }
});

test('dot product requires exactly matching physical f64 shapes', () => {
  assert.throws(() => referenceF64Reduction(arr([1, 2]), { rhs: arr([1]) }), /shape mismatch/);
  assert.throws(() => referenceF64Reduction([1, 2]), /Float64Array/);
  assert.throws(() => referenceF64Reduction(arr([1]), { rhs: [2] }), /Float64Array/);
});

test('rejects NaN, infinity and arithmetic intermediate overflow', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => referenceF64Reduction(arr([value]), { tileSize: 2 }), /finite/);
    assert.throws(() => referenceF64Reduction(arr([1]), { rhs: arr([value]), tileSize: 2 }), /finite/);
  }
  assert.throws(() => referenceF64Reduction(arr([Number.MAX_VALUE, Number.MAX_VALUE]), { tileSize: 2 }), /finite/);
  assert.throws(() => referenceF64Reduction(arr([Number.MAX_VALUE]), { rhs: arr([2]), tileSize: 2 }), /finite/);
  assert.throws(() => mergeF64TilePartials(planF64Tiles(4, 2), [
    { tile: 0, value: Number.MAX_VALUE }, { tile: 1, value: Number.MAX_VALUE },
  ]), /finite/);
});

test('rejects malformed, oversized and non-power-of-two tile plans', () => {
  for (const length of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER, MAX_F64_ELEMENTS + 1]) {
    assert.throws(() => planF64Tiles(length), /length/);
  }
  for (const size of [0, 1, 3, 33, 4097, NaN, Infinity, 2.5]) {
    assert.throws(() => planF64Tiles(16, size), /tileSize/);
  }
});

test('rejects missing, duplicated, unknown and nonfinite partials', () => {
  const plan = planF64Tiles(4, 2);
  const good = [{ tile: 1, value: 3 }, { tile: 0, value: 4 }];
  assert.equal(mergeF64TilePartials(plan, good), 7);
  for (const bad of [
    [], [{ tile: 0, value: 1 }, { tile: 0, value: 2 }],
    [{ tile: -1, value: 1 }, good[1]],
    [{ tile: 2, value: 1 }, good[1]],
    [{ tile: 0, value: NaN }, good[1]],
    [null, good[1]],
  ]) assert.throws(() => mergeF64TilePartials(plan, bad), /partial|count/);
});

test('rejects dishonest tile schedules before reading any data', () => {
  const data = arr([1, 2, 3, 4]);
  for (const bad of [[0], [0, 0], [0, 2], [-1, 1], [0, 1.1], '0,1', [0, undefined]]) {
    assert.throws(() => computeF64TilePartials(data, { tileSize: 2, visitOrder: bad }), /visitOrder/);
  }
});

test('zero-sized input is well-defined, without imaginary workers', () => {
  const result = referenceF64Reduction(arr([]));
  assert.deepEqual(result, { value: 0, tiles: 0 });
  assert.equal(f64HexBits(result.value), '0000000000000000');
});

test('host reference never silently changes tile grouping based on worker count', () => {
  const data = arr([1e16, 1, -1e16, 1]);
  const sum2 = referenceF64Reduction(data, { tileSize: 2 }).value;
  const sum4 = referenceF64Reduction(data, { tileSize: 4 }).value;
  assert.equal(sum2, 0);
  assert.equal(sum4, 1);
  // Tile size is semantic input: worker count must not select another tile size.
  assert.notEqual(f64HexBits(sum2), f64HexBits(sum4));
});

test('rejects unfenced shared and resizable backing memory', () => {
  if (typeof SharedArrayBuffer !== 'undefined') {
    assert.throws(() => referenceF64Reduction(new Float64Array(new SharedArrayBuffer(16))), /unfenced/);
  }
  const resizable = new ArrayBuffer(16, { maxByteLength: 32 });
  assert.throws(() => referenceF64Reduction(new Float64Array(resizable)), /resizable/);
});
