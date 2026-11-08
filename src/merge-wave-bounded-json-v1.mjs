// Bound authenticated GitHub evidence before decoding/parsing response bodies.
// A missing/oversized/malformed response is never usable merge-readiness evidence.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export async function readBoundedProviderJson(response, maxBytes = DEFAULT_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES)
    throw new RangeError('Invalid provider response byte limit');
  if (!response?.ok) throw new Error('Unsuccessful provider response');

  const contentLength = response.headers?.get?.('content-length');
  if (typeof contentLength === 'string' && /^[0-9]+$/.test(contentLength) &&
      Number(contentLength) > maxBytes)
    throw new Error('Provider JSON response exceeds byte limit');

  // Native fetch responses expose a stream. Keep the fallback for small,
  // explicitly supplied test/provider mocks; it is never the HTTP fast path.
  if (typeof response.body?.getReader !== 'function') {
    if (typeof response.json !== 'function') throw new Error('Missing provider JSON body');
    const value = await response.json();
    const canonical = JSON.stringify(value);
    if (typeof canonical !== 'string' ||
        Buffer.byteLength(canonical, 'utf8') > maxBytes)
      throw new Error('Provider JSON response exceeds byte limit');
    return value;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0, finished = false;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) { finished = true; break; }
      if (!(value instanceof Uint8Array))
        throw new Error('Malformed provider response stream');
      byteCount += value.byteLength;
      if (byteCount > maxBytes)
        throw new Error('Provider JSON response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!finished) {
      try { await reader.cancel(); } catch { /* fail-closed; cancellation is best effort */ }
    }
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, byteCount);
  const json = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  return JSON.parse(json);
}
