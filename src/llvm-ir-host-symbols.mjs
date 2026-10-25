/**
 * Rewrite LLVM's unquoted @main global symbol token without touching source
 * comments, escaped string data or quoted LLVM metadata/identifiers.
 *
 * The native numeric adapter separately validates the exact i64 guest/i32
 * host definition count. This routine handles lexical symbol references.
 */
const isNameContinuation = char =>
  typeof char === 'string' && /[A-Za-z0-9$._-]/.test(char);
const isHex = char => typeof char === 'string' && /[0-9A-Fa-f]/.test(char);

export function rewriteLLVMIRHostMainReferences(ir) {
  if (typeof ir !== 'string' || ir.length < 1 || ir.length > 4 * 1024 * 1024) {
    throw Error('invalid or oversized LLVM IR for symbol rewrite');
  }
  const before = '@main';
  const after = '@oreslang_numeric_unused_host_main';
  let output = '';
  let i = 0;
  let replacements = 0;
  let quoted = false;
  while (i < ir.length) {
    const char = ir[i];
    if (quoted) {
      // LLVM quoted strings/identifiers can use \XX byte escapes. Consume the
      // complete escape so an escaped quote byte cannot alter lexer state.
      if (char === '\\' && isHex(ir[i + 1]) && isHex(ir[i + 2])) {
        output += ir.slice(i, i + 3);
        i += 3;
      } else if (char === '\\' && i + 1 < ir.length) {
        output += ir.slice(i, i + 2);
        i += 2;
      } else {
        output += char;
        if (char === '"') quoted = false;
        i++;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      output += char;
      i++;
      continue;
    }
    if (char === ';') {
      // Treat LF, CRLF and CR as line endings. This is deliberately lexical:
      // comment contents are copied byte-for-byte and never inspected.
      let end = i;
      while (end < ir.length && ir[end] !== '\n' && ir[end] !== '\r') end++;
      if (end === ir.length) {
        output += ir.slice(i);
        i = end;
        continue;
      }
      let afterEnd = end + 1;
      if (ir[end] === '\r' && ir[end + 1] === '\n') afterEnd++;
      output += ir.slice(i, afterEnd);
      i = afterEnd;
      continue;
    }
    if (ir.startsWith(before, i) && !isNameContinuation(ir[i + before.length])) {
      output += after;
      replacements++;
      i += before.length;
      continue;
    }
    output += char;
    i++;
  }
  if (quoted) throw Error('unterminated quoted LLVM string or identifier');
  if (replacements < 1) {
    throw Error('LLVM IR contains no unquoted main symbol reference');
  }
  return Object.freeze({ir: output, referencesRewritten: replacements});
}
