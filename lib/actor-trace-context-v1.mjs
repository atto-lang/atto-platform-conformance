import {randomBytes} from 'node:crypto';

// Reference only: not a guest-language runtime or a W3C OTLP exporter.
// Immutable, bounded trace context is copied between actor ownership domains.
const VALID_TRACE = /^[a-f0-9]{32}$/;
const VALID_SPAN = /^[a-f0-9]{16}$/;
const VALID_FLAGS = /^[a-f0-9]{2}$/;
const allZero = text => /^0+$/.test(text);
const newId = bytes => {
  let id;
  do { id = randomBytes(bytes).toString('hex'); } while (allZero(id));
  return id;
};
const copyContext = ({trace_id, span_id, trace_flags, tracestate = ''}) =>
  Object.freeze({trace_id, span_id, trace_flags, tracestate});

export function parseTraceparent(value) {
  if (typeof value !== 'string' || value.length !== 55) return null;
  const parts = value.split('-');
  if (parts.length !== 4 || parts[0] !== '00' ||
      !VALID_TRACE.test(parts[1]) || allZero(parts[1]) ||
      !VALID_SPAN.test(parts[2]) || allZero(parts[2]) || !VALID_FLAGS.test(parts[3])) return null;
  return copyContext({trace_id: parts[1], span_id: parts[2], trace_flags: parts[3]});
}

// Invalid tracestate never invalidates a valid traceparent. Remove whole
// entries beyond local limits, not parts of them; do not carry arbitrary baggage.
export function sanitizeTracestate(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) return '';
  const retained = [];
  const keys = new Set();
  let size = 0;
  for (const candidate of raw.split(',')) {
    const item = candidate.trim();
    const equal = item.indexOf('=');
    if (equal < 1) continue;
    const key = item.slice(0, equal);
    const value = item.slice(equal + 1);
    if (!/^[a-z0-9][a-z0-9_*/@.-]{0,255}$/.test(key) ||
        !/^[\x20-\x2b\x2d-\x7e]{1,256}$/.test(value) || keys.has(key)) continue;
    const add = item.length + (retained.length ? 1 : 0);
    if (retained.length >= 32 || size + add > 512) break;
    retained.push(item);
    keys.add(key);
    size += add;
  }
  return retained.join(',');
}

export function extractTraceContext(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  let parent = null, state = null;
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (key === 'traceparent') {
      if (parent !== null || typeof value !== 'string') return null;
      parent = value;
    }
    if (key === 'tracestate') {
      if (state !== null || typeof value !== 'string') return null;
      state = value;
    }
  }
  const parsed = parseTraceparent(parent);
  return parsed ? copyContext({...parsed, tracestate: sanitizeTracestate(state)}) : null;
}

export function formatTraceparent(context) {
  if (!context || !VALID_TRACE.test(context.trace_id) || allZero(context.trace_id) ||
      !VALID_SPAN.test(context.span_id) || allZero(context.span_id) ||
      !VALID_FLAGS.test(context.trace_flags) ||
      typeof (context.tracestate ?? '') !== 'string' ||
      sanitizeTracestate(context.tracestate ?? '') !== (context.tracestate ?? ''))
    throw new TypeError('invalid trace context');
  return '00-' + context.trace_id + '-' + context.span_id + '-' + context.trace_flags;
}

export function newRootContext({sampled = false} = {}) {
  return copyContext({trace_id: newId(16), span_id: newId(8), trace_flags: sampled ? '01' : '00'});
}

export function messageEnvelope(payload, context, messageId) {
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 128)
    throw new TypeError('bounded message identity is required');
  if (context !== null && context !== undefined) formatTraceparent(context);
  return Object.freeze({payload, message_id: messageId,
    trace_context: context ? copyContext(context) : null});
}

export function captureContinuation(context) {
  if (context !== null && context !== undefined) formatTraceparent(context);
  return Object.freeze({trace_context: context ? copyContext(context) : null});
}

export function resumeContinuation(frame) {
  if (!frame || !Object.hasOwn(frame, 'trace_context')) throw new TypeError('invalid continuation');
  if (frame.trace_context !== null) formatTraceparent(frame.trace_context);
  return frame.trace_context ? copyContext(frame.trace_context) : null;
}

// Messaging defaults to span links for fan-out/batch processing.
export function receivingSpan(envelope, {correlation = 'link', sampled = false} = {}) {
  if (!envelope || !Object.hasOwn(envelope, 'trace_context')) throw new TypeError('invalid actor envelope');
  const upstream = envelope.trace_context;
  if (upstream !== null) formatTraceparent(upstream);
  if (!['link', 'parent'].includes(correlation)) throw new TypeError('unknown correlation');
  const root = newRootContext({sampled});
  if (!upstream) return Object.freeze({context: root, parent_span_id: null, links: Object.freeze([])});
  if (correlation === 'parent') {
    const child = copyContext({trace_id: upstream.trace_id, span_id: root.span_id,
      trace_flags: upstream.trace_flags, tracestate: upstream.tracestate});
    return Object.freeze({context: child, parent_span_id: upstream.span_id, links: Object.freeze([])});
  }
  return Object.freeze({context: root, parent_span_id: null,
    links: Object.freeze([copyContext(upstream)])});
}

// Test reference, not a production lock-free MPSC telemetry queue.
export class BoundedTelemetryBuffer {
  #items = [];
  #dropped = 0;
  constructor(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65536)
      throw new RangeError('telemetry capacity must be bounded');
    this.capacity = capacity;
  }
  tryOffer(record) {
    if (this.#items.length >= this.capacity) {
      this.#dropped++;
      return false;
    }
    this.#items.push(record);
    return true;
  }
  drain(max = this.capacity) {
    if (!Number.isSafeInteger(max) || max < 0 || max > this.capacity)
      throw new RangeError('invalid drain bound');
    return this.#items.splice(0, max);
  }
  get size() { return this.#items.length; }
  get dropped() { return this.#dropped; }
}
