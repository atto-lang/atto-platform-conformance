import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedProviderJson} from '../src/merge-wave-bounded-json-v1.mjs';

const bytes = value => new TextEncoder().encode(value);
const stream = (parts, onCancel = () => {}) => new ReadableStream({
  start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); },
  cancel: onCancel
});
const response = (body, headers = {}) => ({
  ok:true, body, headers:{get:key=>headers[key.toLowerCase()] ?? null}
});

test('accept bounded streamed GitHub JSON without losing evidence fields', async () => {
  const payload='{"workflow_runs":[{"id":123,"run_attempt":2}]}';
  const chunks=[bytes(payload.slice(0,18)),bytes(payload.slice(18))];
  assert.deepEqual(await readBoundedProviderJson(response(stream(chunks)),512),
    {workflow_runs:[{id:123,run_attempt:2}]});
});
test('allow an exact byte-limit response, reject one byte over', async () => {
  const body='{"x":1}';
  assert.deepEqual(await readBoundedProviderJson(response(stream([bytes(body)])),bytes(body).length),
    {x:1});
  await assert.rejects(readBoundedProviderJson(response(stream([bytes(body)])),bytes(body).length-1),
    /byte limit/);
});
test('ignore lying small content-length; enforce actual streamed bytes', async () => {
  await assert.rejects(readBoundedProviderJson(response(
    stream([bytes('{"x":"'),bytes('oversized-value"}')]),
    {'content-length':'2'}),10),/byte limit/);
});
test('reject oversized declared content-length before parsing', async () => {
  const huge=response(stream([bytes('{}')]),{'content-length':'99999999999999999'});
  await assert.rejects(readBoundedProviderJson(huge,10),/byte limit/);
});
test('cancel an unconsumed stream after size violation', async () => {
  let cancelled=false;
  const body=new ReadableStream({
    start(controller) { controller.enqueue(bytes('x'.repeat(100))); },
    cancel() { cancelled=true; }
  });
  await assert.rejects(readBoundedProviderJson(response(body),16),/byte limit/);
  assert.equal(cancelled,true);
});
test('reject invalid UTF-8 rather than decoding with replacement characters', async () => {
  await assert.rejects(readBoundedProviderJson(response(stream([Uint8Array.of(0xff)])),10),
    /encoded|valid|utf-8|UTF-8/i);
});
test('reject truncated or malformed streamed JSON', async () => {
  await assert.rejects(readBoundedProviderJson(response(stream([bytes('{"x":')])),20),
    /Unexpected|JSON|end/i);
});
test('preserve compatibility with bounded mocked provider JSON responses', async () => {
  const mock={ok:true,json:async()=>({jobs:[{id:1}]})};
  assert.deepEqual(await readBoundedProviderJson(mock,40),{jobs:[{id:1}]});
  await assert.rejects(readBoundedProviderJson(mock,5),/byte limit/);
});
test('reject missing stream and missing JSON reader', async () => {
  await assert.rejects(readBoundedProviderJson({ok:true},20),/Missing provider JSON body/);
});
test('reject invalid response limits and malformed success state', async () => {
  await assert.rejects(readBoundedProviderJson({ok:true},0),/Invalid provider/);
  await assert.rejects(readBoundedProviderJson({ok:false},20),/Unsuccessful/);
});
