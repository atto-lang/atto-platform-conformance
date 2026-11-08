/** Strict reader for security-sensitive JSON receipts and promotion policies.
 * JSON.parse itself allows duplicate object keys (last value wins), creating
 * ambiguous audit evidence. Reject duplicates including Unicode-escaped keys.
 * The scanner only validates shape/uniqueness; JSON.parse remains the decoder.
 */
export function parseStrictJson(text, label = 'input') {
  const MAX_BYTES = 1_048_576;
  const MAX_DEPTH = 80;
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES)
    throw Error(label + ' JSON exceeds size limit or is not text');
  let i = 0;
  const invalid = () => { throw Error(label + ' JSON is ambiguous or invalid'); };
  const ws = () => { while (i < text.length && /[ \t\r\n]/.test(text[i])) i++; };
  const stringToken = () => {
    ws();
    if (text[i] !== '"') invalid();
    const start = i++;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, i)); } catch { invalid(); }
      }
      if (ch === '\\') {
        if (i >= text.length) invalid();
        const esc = text[i++];
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) invalid();
          i += 4;
        } else if (!'"\\/bfnrt'.includes(esc)) invalid();
      } else if (ch.charCodeAt(0) < 0x20) invalid();
    }
    invalid();
  };
  const primitive = () => {
    ws();
    const match = text.slice(i).match(/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/);
    if (!match) invalid();
    i += match[0].length;
  };
  const value = (depth) => {
    if (depth > MAX_DEPTH) throw Error(label + ' JSON nesting limit exceeded');
    ws();
    if (text[i] === '{') object(depth + 1);
    else if (text[i] === '[') array(depth + 1);
    else if (text[i] === '"') stringToken();
    else primitive();
    ws();
  };
  const object = (depth) => {
    if (depth > MAX_DEPTH) throw Error(label + ' JSON nesting limit exceeded');
    i++; ws();
    const keys = new Set();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      const key = stringToken();
      if (keys.has(key)) throw Error(label + ' JSON contains duplicate object key: ' + key);
      keys.add(key);
      ws();
      if (text[i++] !== ':') invalid();
      value(depth);
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      invalid();
    }
  };
  const array = (depth) => {
    if (depth > MAX_DEPTH) throw Error(label + ' JSON nesting limit exceeded');
    i++; ws();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      value(depth);
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      invalid();
    }
  };
  value(0);
  if (i !== text.length) invalid();
  try { return JSON.parse(text); } catch { invalid(); }
}
