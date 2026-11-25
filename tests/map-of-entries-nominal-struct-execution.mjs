// Executable Rust browser-compiler profile against the canonical conformance
// fixtures (not copied compiler-local examples). Never claims 11-backend parity.
// Usage: ATTOC=/path/to/attoc ATTO_WASM=/path/to/atto_compiler.wasm node tests/map-of-entries-nominal-struct-execution.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const fromRepo = path => new URL('../' + path, import.meta.url);
const contract = JSON.parse(readFileSync(fromRepo('contracts/map-of-entries-nominal-struct-v1.json'), 'utf8'));
assert.equal(contract.contract, 'atto-map-of-entries-nominal-struct-v1');
assert.equal(contract.status, 'TARGET_NOT_EXECUTED');
const targetOnly = new Set(['map_entries_const_42', 'map_entries_variable_42']);
for (const id of targetOnly) assert.ok(contract.cases.some(c => c.id === id && c.expect === 'accept'), id);
const native = process.env.ATTOC;
const wasm = process.env.ATTO_WASM;
if (!native || !wasm) throw new Error('ATTOC and ATTO_WASM are required; no host simulation');
const nativePath = resolve(native);
const compilerBytes = readFileSync(resolve(wasm));
const compilerModule = new WebAssembly.Module(compilerBytes);
assert.deepEqual(WebAssembly.Module.imports(compilerModule), [], 'browser compiler must have zero imports');
const compiler = new WebAssembly.Instance(compilerModule, {}).exports;
assert.equal(compiler.abi_version(), 2);
const encoder = new TextEncoder(), decoder = new TextDecoder();

function browserCompile(source) {
  const data = encoder.encode(source);
  assert.ok(data.length < compiler.input_capacity(), 'fixture exceeds compiler capacity');
  new Uint8Array(compiler.memory.buffer, compiler.input_ptr(), data.length).set(data);
  const status = compiler.compile(data.length);
  if (status === 0) {
    const bytes = new Uint8Array(compiler.memory.buffer, compiler.result_ptr(), compiler.result_length()).slice();
    assert.deepEqual([...bytes.slice(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
    return {ok: true, bytes};
  }
  assert.equal(status, 1, 'unknown compiler status');
  assert.equal(compiler.result_length(), 0, 'rejected program produced a Wasm artifact');
  const memory = new Uint8Array(compiler.memory.buffer);
  const start = compiler.error_ptr();
  let end = start;
  while (end < memory.length && memory[end] !== 0) end++;
  assert.ok(end < memory.length, 'unterminated diagnostic');
  return {ok: false, error: decoder.decode(memory.slice(start, end))};
}

function executeGuest(bytes) {
  let instance, stdout = '';
  const imports = {
    print_i64(x) {stdout += String(x);},
    print_bool(x) {stdout += x ? 'true' : 'false';},
    print_f64(x) {stdout += String(x);},
    print_str(ptr, len) {stdout += decoder.decode(new Uint8Array(instance.exports.memory.buffer, ptr, len));},
    print_newline() {stdout += '\n';},
    actor_spawn() {throw new Error('actor execution not admitted');},
    actor_send() {throw new Error('actor execution not admitted');}
  };
  const module = new WebAssembly.Module(bytes);
  for (const entry of WebAssembly.Module.imports(module)) {
    assert.equal(entry.module, 'atto');
    assert.ok(Object.hasOwn(imports, entry.name), 'unexpected host import: ' + entry.name);
  }
  instance = new WebAssembly.Instance(module, {atto: imports});
  return {exit: instance.exports.main(), stdout};
}

const receipt = {
  contract: contract.contract,
  compiler_profile: 'rs-browser-wasm',
  native_compiler_sha256: createHash('sha256').update(readFileSync(nativePath)).digest('hex'),
  browser_compiler_sha256: createHash('sha256').update(compilerBytes).digest('hex'),
  executed: [],
  target_not_executed: []
};
for (const entry of contract.cases) {
  if (targetOnly.has(entry.id)) {
    receipt.target_not_executed.push(entry.id);
    continue;
  }
  const fixture = fromRepo(entry.fixture);
  const source = readFileSync(fixture, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  const host = spawnSync(nativePath, [fileURLToPath(fixture)], {encoding: null, maxBuffer: 4 * 1024 * 1024});
  assert.equal(host.error, undefined, entry.id + ': native compiler unavailable');
  const browser = browserCompile(source);
  if (entry.expect === 'accept') {
    assert.equal(host.status, 0, entry.id + ': ' + String(host.stderr));
    assert.equal(browser.ok, true, entry.id + ': ' + browser.error);
    assert.deepEqual(host.stdout, Buffer.from(browser.bytes), entry.id + ': native/browser Wasm bytes differ');
    const result = executeGuest(browser.bytes);
    assert.equal(result.exit, BigInt(entry.expected_exit), entry.id + ': incorrect guest result');
    receipt.executed.push({id: entry.id, result: 'PASS', fixture_sha256: digest, guest_exit: String(result.exit)});
  } else {
    assert.equal(entry.expect, 'reject', entry.id + ': invalid expectation');
    assert.equal(host.status, 1, entry.id + ': invalid program admitted');
    assert.equal(host.stdout.length, 0, entry.id + ': rejected program generated native output');
    assert.ok(String(host.stderr).includes(entry.expected_error), entry.id + ': ' + String(host.stderr));
    assert.equal(browser.ok, false, entry.id + ': browser admitted invalid program');
    assert.equal(browser.error.split(':')[0], entry.expected_error, entry.id + ': wrong diagnostic');
    receipt.executed.push({id: entry.id, result: 'REJECTED_AS_EXPECTED', fixture_sha256: digest, diagnostic: entry.expected_error});
  }
}
assert.equal(receipt.executed.length, contract.cases.length - targetOnly.size);
console.log(JSON.stringify(receipt, null, 2));
console.log('PROFILE VERIFIED: ' + receipt.executed.length + ' executed; ' + receipt.target_not_executed.length + ' targets NOT_EXECUTED. Registry unchanged.');
