#!/usr/bin/env node
// Narrow AttoLang guest ABI v2 adapter for scalar/class-only Wasm.
// Maps the guest's exported i64 main() return to an OS exit status.
// Actor/state imports and unknown ABI exports fail closed, never simulate execution.
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) {
  console.error('usage: node bin/borrow_guest_exit.mjs guest.wasm');
  process.exit(1);
}
try {
  const bytes = readFileSync(path);
  if (!WebAssembly.validate(bytes)) throw new Error('invalid WebAssembly guest');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const printed = new Set(['print_i64', 'print_bool', 'print_str', 'print_newline', 'print_f64']);
  if (imports.some(i => i.module !== 'atto' || i.kind !== 'function' || !printed.has(i.name))) {
    throw new Error('unsupported actor/state/foreign import in scalar-class adapter');
  }
  const exports = WebAssembly.Module.exports(module);
  const names = exports.map(e => e.name);
  if (!names.includes('main') || !names.includes('panic_code') ||
      names.some(n => !['main', 'panic_code', 'memory'].includes(n))) {
    throw new Error('unexpected Atto guest ABI exports');
  }
  if (WebAssembly.Module.customSections(module, 'atto.actors').length > 0) {
    throw new Error('actor guests require the full Atto worker runtime');
  }
  let instance;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const host = {
    print_i64: v => process.stdout.write(v.toString()),
    print_bool: v => process.stdout.write(v ? 'true' : 'false'),
    print_str: (offset, length) => {
      if (!instance?.exports?.memory) throw new Error('missing Wasm memory for print_str');
      const memory = new Uint8Array(instance.exports.memory.buffer);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
          offset < 0 || length < 0 || offset > memory.length || length > memory.length - offset) {
        throw new Error('invalid guest string bounds');
      }
      process.stdout.write(utf8.decode(memory.subarray(offset, offset + length)));
    },
    print_newline: () => process.stdout.write('\n'),
    print_f64: v => process.stdout.write(String(v)),
  };
  instance = new WebAssembly.Instance(module, { atto: host });
  if (typeof instance.exports.main !== 'function' ||
      !(instance.exports.panic_code instanceof WebAssembly.Global)) {
    throw new Error('invalid Atto guest main/panic_code types');
  }
  const actual = instance.exports.main();
  if (typeof actual !== 'bigint') throw new Error('Atto main() did not return i64');
  if (instance.exports.panic_code.value !== 0) throw new Error('Atto guest panicked');
  if (actual < 0n || actual > 255n) throw new Error('i64 result not representable as process exit status');
  process.exitCode = Number(actual);
} catch (error) {
  console.error('ATTO_GUEST_INVALID: ' + (error?.message || String(error)));
  process.exitCode = 1;
}
