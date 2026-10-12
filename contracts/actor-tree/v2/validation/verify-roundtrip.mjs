// Semantic constraints which JSON Schema and TypeSpec cannot express alone.
// No network or package dependencies; run with Node 22+.
export const MIN_I64 = -(1n << 63n);
export const MAX_I64 = (1n << 63n) - 1n;
const HEX64 = /^[a-f0-9]{64}$/;
const CANONICAL_INT = /^(0|-?[1-9][0-9]*)$/;

export function identityKey(actor) {
  if (!actor || typeof actor.runtimeId !== 'string' || !actor.runtimeId.length ||
      typeof actor.actorId !== 'string' || !actor.actorId.length ||
      !Number.isInteger(actor.incarnation) || actor.incarnation < 1 ||
      actor.incarnation > 2147483647) {
    throw new TypeError('invalid physical actor identity');
  }
  return JSON.stringify([actor.runtimeId, actor.actorId, actor.incarnation]);
}
export function signedI64(value) {
  if (typeof value !== 'string' || value.length > 20 || !CANONICAL_INT.test(value)) {
    throw new TypeError('signed i64 must be a canonical decimal string');
  }
  const parsed = BigInt(value);
  if (parsed < MIN_I64 || parsed > MAX_I64) {
    throw new RangeError('signed i64 outside [-2^63, 2^63-1]');
  }
  return parsed;
}

export function verifyRoundTrip(trace) {
  if (!trace || trace.schemaVersion !== '2.0.0' || !Array.isArray(trace.route)
      || trace.route.length !== 3 || !Array.isArray(trace.messages)
      || trace.messages.length !== 4) {
    throw new Error('expected v2 three-actor, four-hop round trip');
  }
  if (typeof trace.pipelineId !== 'string' || !trace.pipelineId.length ||
      trace.pipelineId.length > 128) {
    throw new Error('invalid pipelineId');
  }
  const route = trace.route;
  const keys = route.map(identityKey);
  if (new Set(keys).size !== 3) throw new Error('route actors must be distinct incarnations');
  const logicalKeys = route.map(a => JSON.stringify([a.runtimeId, a.actorId]));
  if (new Set(logicalKeys).size !== 3) {
    throw new Error('three pipeline stages must be distinct logical actors');
  }
  if (!route.every(a => a.runtimeId === route[0].runtimeId)) {
    throw new Error('cross-runtime actor route is not authorized');
  }
  const expected = [
    ['forward', 0, 1], ['forward', 1, 2],
    ['backward', 2, 1], ['backward', 1, 0],
  ];
  const ids = new Set();
  let schemaHash;
  let variant;
  const payloads = [];
  for (const [i, message] of trace.messages.entries()) {
    const [direction, fromIndex, toIndex] = expected[i];
    if (!message || message.direction !== direction || message.hopIndex !== i ||
        identityKey(message.from) !== keys[fromIndex] ||
        identityKey(message.to) !== keys[toIndex]) {
      throw new Error("hop " + i + " violates typed " + direction + " actor route");
    }
    if (typeof message.messageId !== 'string' || !message.messageId.length ||
        message.messageId.length > 128 || ids.has(message.messageId)) {
      throw new Error('duplicate or missing messageId');
    }
    ids.add(message.messageId);
    if (typeof message.schemaHash !== 'string' || !HEX64.test(message.schemaHash)) {
      throw new Error('invalid signed-64 schema hash');
    }
    if (schemaHash !== undefined && schemaHash !== message.schemaHash) {
      throw new Error('schemaHash changed across typed pipeline');
    }
    schemaHash = message.schemaHash;
    if (!message.payload || typeof message.payload.variant !== 'string' ||
        !message.payload.variant.length || message.payload.variant.length > 128) {
      throw new Error('missing nominal typed payload variant');
    }
    if (variant !== undefined && variant !== message.payload.variant) {
      throw new Error('nominal variant changed across typed pipeline');
    }
    variant = message.payload.variant;
    payloads.push(signedI64(message.payload.i64Decimal));
  }
  return { route: keys, schemaHash, variant, values: payloads };
}
