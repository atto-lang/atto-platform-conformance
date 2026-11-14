// Executable .atto conformance for a compiler exposing: attoc file.atto -o guest.wasm
// This adapter is only for compatible CLIs, not an assertion that every backend
// has identical flags. Run with: ATTOC=/absolute/path/to/attoc node bin/verify-local-binding-attoc.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts/local-binding-mutability-v1.json'), 'utf8'));
const compiler = process.env.ATTOC;
if (!compiler) throw new Error('ATTOC must point to the native Atto compiler binary');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atto-bindings-'));
let passed = 0;
try {
  for (const item of contract.required_cases) {
    const source = path.join(root, item.path);
    const artifact = path.join(tmp, item.id + '.wasm');
    const run = spawnSync(compiler, [source, '-o', artifact], { encoding: 'utf8', timeout: 30_000 });
    if (run.error) throw run.error;
    if (item.kind === 'fail') {
      assert.notEqual(run.status, 0, item.id + ' unexpectedly compiled');
      assert.ok((run.stderr || '').includes(item.expected_error),
        item.id + ' expected ' + item.expected_error + ': ' + run.stderr);
      assert.ok(!fs.existsSync(artifact), item.id + ' produced a Wasm artifact after rejection');
    } else {
      assert.equal(run.status, 0, item.id + ': ' + run.stderr);
      const bytes = fs.readFileSync(artifact);
      assert.ok(WebAssembly.validate(bytes), item.id + ' is not valid guest Wasm');
      const mod = new WebAssembly.Module(bytes);
      const imports = WebAssembly.Module.imports(mod);
      assert.deepEqual(imports, [], item.id + ' unexpectedly acquired host imports');
      const instance = new WebAssembly.Instance(mod, {});
      assert.equal(instance.exports.main(), BigInt(item.expected_exit), item.id + ' wrong guest result');
      assert.equal(Number(instance.exports.panic_code.value), 0, item.id + ' guest panic');
    }
    console.log(item.id + ': PASS');
    passed++;
  }
  console.log('Binding conformance: ' + passed + '/' + contract.required_cases.length + ' passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
