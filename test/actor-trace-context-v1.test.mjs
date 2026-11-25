import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTraceparent, sanitizeTracestate, extractTraceContext, formatTraceparent,
  newRootContext, messageEnvelope, captureContinuation, resumeContinuation,
  receivingSpan, BoundedTelemetryBuffer} from '../lib/actor-trace-context-v1.mjs';

const parent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
test('W3C v00 traceparent parse/format, sampled flag, and immutable fields', () => {
  const ctx = parseTraceparent(parent);
  assert.ok(ctx && Object.isFrozen(ctx));
  assert.equal(formatTraceparent(ctx), parent);
  assert.equal(ctx.trace_flags, '01');
});
test('reject invalid version, zero IDs, truncated, uppercase, malformed and injected trace headers', () => {
  const bad = [null, '', parent.slice(0,-1), parent.toUpperCase(),
    'ff' + parent.slice(2), '01' + parent.slice(2),
    parent.replace('4bf92f3577b34da6a3ce929d0e0e4736', '0'.repeat(32)),
    parent.replace('00f067aa0ba902b7','0'.repeat(16)),
    parent + '\ntraceparent:00-deadbeef'];
  bad.forEach(input => assert.equal(parseTraceparent(input), null));
  assert.equal(extractTraceContext({'TRACEPARENT': parent,traceparent: parent}), null);
});
test('tracestate propagation bounded, reject duplicate/invalid entries', () => {
  const ctx = extractTraceContext({TraceParent:parent,TraceState:'vendor=x,foo=y,foo=z,bad key=a'});
  assert.equal(ctx.tracestate,'vendor=x,foo=y');
  assert.equal(sanitizeTracestate('good=a,'.repeat(500)).length <= 512, true);
  assert.equal(extractTraceContext({tracestate:'vendor=x'}), null);
  assert.equal(extractTraceContext({traceparent: parent,tracestate:'!badvalue'}).tracestate, '');
});
test('actor envelopes carry immutable copies, not aliased span context', () => {
  const ctx = parseTraceparent(parent);
  const envelope = messageEnvelope(42, ctx, 'm-1');
  assert.notEqual(envelope.trace_context, ctx);
  assert.ok(Object.isFrozen(envelope.trace_context) && Object.isFrozen(envelope));
  assert.equal(envelope.payload,42);
  assert.throws(() => {envelope.trace_context.trace_id = 'f'.repeat(32);},TypeError);
});
test('continuation capture and resume preserves logical span, not OS thread state', () => {
  const ctx = parseTraceparent(parent);
  const frame = captureContinuation(ctx);
  const restored = resumeContinuation(frame);
  assert.notEqual(ctx, restored);
  assert.equal(formatTraceparent(restored), parent);
  assert.ok(Object.isFrozen(frame) && Object.isFrozen(restored));
});
test('fan-out uses independently owned, span-linked operations by default', () => {
  const original = parseTraceparent(parent);
  const out = [messageEnvelope(1,original,'m1'),messageEnvelope(2,original,'m2')];
  const a = receivingSpan(out[0]);
  const b = receivingSpan(out[1]);
  assert.equal(a.parent_span_id,null);
  assert.equal(a.links[0].trace_id,original.trace_id);
  assert.equal(b.links[0].span_id,original.span_id);
  assert.notEqual(a.context.trace_id,b.context.trace_id);
  assert.ok(Object.isFrozen(a.links) && Object.isFrozen(a.links[0]));
});
test('single-message parent-child correlation is explicit alternative', () => {
  const ctx = parseTraceparent(parent);
  const result = receivingSpan(messageEnvelope(1,ctx,'m1'),{correlation:'parent'});
  assert.equal(result.context.trace_id,ctx.trace_id);
  assert.equal(result.parent_span_id,ctx.span_id);
  assert.notEqual(result.context.span_id,ctx.span_id);
  assert.deepEqual(result.links,[]);
});
test('unsampled contexts do not implicitly grant tracing authority', () => {
  const ctx = newRootContext({sampled:false});
  assert.equal(ctx.trace_flags,'00');
  const next = receivingSpan(messageEnvelope(1,ctx,'m1'),{sampled:false});
  assert.equal(next.context.trace_flags,'00');
});
test('bounded telemetry try-offer and drain never expands on backpressure', () => {
  const q = new BoundedTelemetryBuffer(2);
  assert.equal(q.tryOffer({id:1}),true);
  assert.equal(q.tryOffer({id:2}),true);
  assert.equal(q.tryOffer({id:3}),false);
  assert.equal(q.dropped,1);
  assert.equal(q.size,2);
  assert.deepEqual(q.drain(1),[{id:1}]);
  assert.deepEqual(q.drain(),[{id:2}]);
  assert.equal(q.size,0);
  assert.throws(() => new BoundedTelemetryBuffer(Number.MAX_SAFE_INTEGER));
});
test('reject malformed messages, missing frames and correlation modes', () => {
  const ctx = parseTraceparent(parent);
  assert.throws(() => messageEnvelope(1,ctx,'x'.repeat(129)));
  assert.throws(() => messageEnvelope(1,{...ctx,tracestate:'vendor=' + 'x'.repeat(600)},'x'));
  assert.throws(() => receivingSpan(messageEnvelope(1,ctx,'x'),{correlation:'unbounded'}));
  assert.throws(() => resumeContinuation({}));
  assert.throws(() => formatTraceparent({trace_id:'0'.repeat(32),span_id:'0'.repeat(16),trace_flags:'01'}));
});
