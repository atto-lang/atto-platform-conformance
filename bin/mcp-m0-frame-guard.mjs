// Source-free M0 test/reference framing guard. This is NOT a network MCP server.
// It performs bounded, strict UTF-8 and JSON validation BEFORE JSON.parse is trusted.
const DEFAULT_MAX_BYTES = 32 * 1024;
const DEFAULT_MAX_DEPTH = 12;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/* Typed-array subclass getters may lie about byteLength or buffer: the
 * decoder still sees the full backing bytes. Read intrinsic view geometry
 * before enforcing the admission budget, not overridable JS properties. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const viewByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;

export class M0FrameError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'M0FrameError';
    this.reason = reason;
  }
}

export function parseM0Frame(frame, { maxBytes = DEFAULT_MAX_BYTES, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  if (!ArrayBuffer.isView(frame) || !(frame instanceof Uint8Array) ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > DEFAULT_MAX_BYTES ||
      !Number.isSafeInteger(maxDepth) || maxDepth <= 0 || maxDepth > DEFAULT_MAX_DEPTH) {
    throw new M0FrameError('MALFORMED');
  }
  let actualBytes;
  try {
    actualBytes = viewByteLength.call(frame);
    const backing = viewBuffer.call(frame);
    // A concurrent worker could modify shared input between validation and
    // decode; an immutable snapshot must come from an unshared view.
    if (typeof SharedArrayBuffer !== 'undefined' && backing instanceof SharedArrayBuffer)
      throw new M0FrameError('MALFORMED');
  } catch {
    // Rejected Proxy or detached buffer must never leak a TypeError.
    throw new M0FrameError('MALFORMED');
  }
  if (actualBytes > maxBytes) throw new M0FrameError('OVERFLOW');
  if (actualBytes === 0) throw new M0FrameError('MALFORMED');
  let source;
  try { source = utf8.decode(frame); } catch { throw new M0FrameError('MALFORMED'); }
  // Reject a leading BOM. The JSON-RPC frame must have one canonical interpretation.
  if (source.charCodeAt(0) === 0xfeff) throw new M0FrameError('MALFORMED');
  let i = 0;
  const ws = () => { while (i < source.length && /[ \t\n\r]/.test(source[i])) i++; };
  const fail = (reason = 'MALFORMED') => { throw new M0FrameError(reason); };
  const take = (char) => { if (source[i] !== char) fail(); i++; };
  function string() {
    const begin = i;
    take('"');
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') {
        try {
          const decoded = JSON.parse(source.slice(begin, i));
          if (typeof decoded !== 'string') fail();
          // JSON.parse accepts isolated \\uD800/\\uDC00 escapes, but those are
          // not Unicode scalar values. Cross-language MCP peers must not
          // receive ambiguous or ill-formed escaped UTF-16 strings or keys.
          for (let k = 0; k < decoded.length; k++) {
            const unit = decoded.charCodeAt(k);
            if (unit >= 0xd800 && unit <= 0xdbff) {
              const next = decoded.charCodeAt(++k);
              if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
            } else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
          }
          return decoded;
        } catch { fail(); }
      }
      if (c === '\\') {
        const esc = source[i++];
        if (!esc || !'"\\/bfnrtu'.includes(esc)) fail();
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i, i + 4))) fail();
          i += 4;
        }
      } else if (c.charCodeAt(0) < 0x20) fail();
    }
    fail();
  }
  // Sticky matching avoids quadratic repeated source.slice() on long arrays.
  const numberToken = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  function atom() {
    if (source.startsWith('true', i)) { i += 4; return; }
    if (source.startsWith('false', i)) { i += 5; return; }
    if (source.startsWith('null', i)) { i += 4; return; }
    numberToken.lastIndex = i;
    const number = numberToken.exec(source);
    if (!number) fail();
    if (!Number.isFinite(Number(number[0]))) fail();
    i += number[0].length;
  }
  function value(depth) {
    ws();
    const c = source[i];
    if (c === '{') {
      if (depth + 1 > maxDepth) fail('OVERFLOW');
      i++;
      ws();
      if (source[i] === '}') { i++; return; }
      const keys = new Set();
      while (true) {
        ws();
        if (source[i] !== '"') fail();
        const key = string();
        // Decoded key comparison closes JSON escape-key ambiguity.
        if (keys.has(key)) fail();
        keys.add(key);
        ws(); take(':');
        value(depth + 1);
        ws();
        if (source[i] === '}') { i++; return; }
        take(',');
      }
    }
    if (c === '[') {
      if (depth + 1 > maxDepth) fail('OVERFLOW');
      i++;
      ws();
      if (source[i] === ']') { i++; return; }
      while (true) {
        value(depth + 1);
        ws();
        if (source[i] === ']') { i++; return; }
        take(',');
      }
    }
    if (c === '"') { string(); return; }
    atom();
  }
  ws();
  // JSON-RPC request envelopes must be objects, never primitive or array roots.
  if (source[i] !== '{') fail();
  value(0);
  ws();
  if (i !== source.length) fail();
  try {
    const message = JSON.parse(source);
    if (message === null || Array.isArray(message) || typeof message !== 'object') fail();
    return message;
  } catch { fail(); }
}
