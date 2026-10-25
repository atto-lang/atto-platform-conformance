/**
 * Rewrite LLVM's unquoted @main function reference without touching source
 * comments, escaped string data or quoted LLVM metadata.
 *
 * The native numeric adapter separately validates the exact i64 guest/i32
 * host definition count. This routine handles only lexical symbol references.
 */
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
      // LLVM quoted strings use backslash escapes including \22 hex escapes.
      // Skip the escaped byte as a unit to avoid toggling on an escaped quote.
      if (char === '\\' && i + 1 < ir.length) {
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
      const end = ir.indexOf('\n', i);
      if (end < 0) {
        output += ir.slice(i);
        break;
      }
      output += ir.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ir.startsWith(before, i)) {
      let next = i + before.length;
      while (ir[next] === ' ' || ir[next] === '\t') next++;
      if (ir[next] === '(') {
        output += after;
        replacements++;
        i += before.length;
        continue;
      }
    }
    output += char;
    i++;
  }
  if (replacements < 1) {
    throw Error('LLVM IR contains no unquoted main function reference');
  }
  return Object.freeze({ir: output, referencesRewritten: replacements});
}
