// Host-only numerical reference for AttoLang HPC reduction v1.
// No compiler, actors, physical SIMD, native threads, or GPU execution occurs here.
export const MAX_F64_ELEMENTS = 1_048_576;
export const DEFAULT_TILE_SIZE = 256;

export function planF64Tiles(length, tileSize = DEFAULT_TILE_SIZE) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_F64_ELEMENTS) {
    throw new RangeError('length must be a bounded nonnegative safe integer');
  }
  if (!Number.isSafeInteger(tileSize) || tileSize < 2 || tileSize > 4096 ||
      (tileSize & (tileSize - 1)) !== 0) {
    throw new RangeError('tileSize must be a power of two in [2, 4096]');
  }
  const plan = [];
  for (let start = 0; start < length; start += tileSize) {
    plan.push(Object.freeze({ tile: plan.length, start, end: Math.min(length, start + tileSize) }));
  }
  return Object.freeze(plan);
}

function requireF64(input, label) {
  if (!(input instanceof Float64Array)) throw new TypeError(label + ' must be a Float64Array');
  if (input.length > MAX_F64_ELEMENTS) throw new RangeError(label + ' exceeds maximum elements');
  if (typeof SharedArrayBuffer !== 'undefined' && input.buffer instanceof SharedArrayBuffer) {
    throw new TypeError(label + ' cannot use an unfenced SharedArrayBuffer');
  }
  if (input.buffer.resizable) throw new TypeError(label + ' cannot use a resizable buffer');
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(label + ' must be finite');
  return value;
}

function scheduleOrder(plan, visitOrder) {
  if (visitOrder === undefined) return plan.map(p => p.tile);
  if (!Array.isArray(visitOrder) || visitOrder.length !== plan.length) {
    throw new RangeError('visitOrder must enumerate every tile exactly once');
  }
  const seen = new Set();
  for (const id of visitOrder) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= plan.length || seen.has(id)) {
      throw new RangeError('visitOrder contains duplicate or out-of-range tile');
    }
    seen.add(id);
  }
  return visitOrder;
}

// Produces independent immutable tile results; visiting tiles out of order models
// worker completion order, NOT actual parallel execution.
export function computeF64TilePartials(lhs, { rhs, tileSize = DEFAULT_TILE_SIZE, visitOrder } = {}) {
  requireF64(lhs, 'lhs');
  if (rhs !== undefined) {
    requireF64(rhs, 'rhs');
    if (rhs.length !== lhs.length) throw new RangeError('dot operand shape mismatch');
  }
  const plan = planF64Tiles(lhs.length, tileSize);
  const order = scheduleOrder(plan, visitOrder);
  const partials = [];
  for (const id of order) {
    const { start, end } = plan[id];
    let value = 0;
    for (let i = start; i < end; i += 1) {
      const a = finite(lhs[i], 'lhs[' + i + ']');
      const term = rhs === undefined ? a : finite(a * finite(rhs[i], 'rhs[' + i + ']'), 'product[' + i + ']');
      value = finite(value + term, 'tile accumulation[' + i + ']');
    }
    partials.push(Object.freeze({ tile: id, value }));
  }
  return Object.freeze(partials);
}

// Fixed binary reduction tree by canonical tile index, never by arrival order.
// Any runtime may compute tile partials concurrently, but cannot alter grouping,
// silently use fast-math/FMA, or skip finite checks in reproducible mode.
export function mergeF64TilePartials(plan, partials) {
  if (!Array.isArray(plan) || !Array.isArray(partials) || partials.length !== plan.length) {
    throw new RangeError('tile plan and partial count must match');
  }
  const ordered = new Array(plan.length);
  const seen = new Set();
  for (const entry of partials) {
    if (entry === null || typeof entry !== 'object' ||
        !Number.isSafeInteger(entry.tile) || entry.tile < 0 || entry.tile >= plan.length ||
        seen.has(entry.tile)) {
      throw new RangeError('partial tile is missing, duplicate or out of range');
    }
    seen.add(entry.tile);
    ordered[entry.tile] = finite(entry.value, 'partial[' + entry.tile + ']');
  }
  let level = ordered;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? finite(level[i] + level[i + 1], 'tree accumulation') : level[i]);
    }
    level = next;
  }
  return level[0] ?? 0;
}

export function referenceF64Reduction(lhs, options = {}) {
  requireF64(lhs, 'lhs');
  const plan = planF64Tiles(lhs.length, options.tileSize ?? DEFAULT_TILE_SIZE);
  const partials = computeF64TilePartials(lhs, options);
  return Object.freeze({ value: mergeF64TilePartials(plan, partials), tiles: plan.length });
}

export function f64HexBits(value) {
  if (typeof value !== 'number') throw new TypeError('value must be f64');
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, '0');
}
