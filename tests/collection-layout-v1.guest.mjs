// Execute real Atto compiler-produced Wasm guests. NOT the manifest self-test.
// Usage: ATTOC=/absolute/path/to/attoc node tests/collection-layout-v1.guest.mjs
// A pass here verifies guest behavior, not the physical field-column ABI by itself.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const atto = process.env.ATTOC;
if (!atto || !resolve(atto).startsWith('/') || !existsSync(atto)) {
    throw new Error('ATTOC must name an existing native attoc compiler executable; no host simulation is permitted');
}
const compilerBytes = readFileSync(atto);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../contracts/collection-layout-v1');
const registry = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8'));
assert.equal(registry.schema, 'atto.collection-layout.v1');
const work = mkdtempSync(join(tmpdir(), 'atto-collection-layout-'));
const report = {
    evidence_kind: 'source_compiled_guest_execution',
    compiler_sha256: sha256(compilerBytes),
    compiler_source_sha: process.env.ATTO_COMPILER_SOURCE_SHA ?? null,
    compiler_source_sha_verified: false,
    node: process.version,
    source_fixtures: [],
    physical_layout_verified: false,
};
try {
    for (const item of registry.cases) {
        const source = resolve(root, item.fixture);
        const text = readFileSync(source);
        const resultPath = join(work, item.id + '.wasm');
        const compiled = spawnSync(atto, [source, '-o', resultPath], {
            timeout: 30_000, encoding: 'utf8', maxBuffer: 1 << 20,
        });
        assert.equal(compiled.error, undefined, item.id + ': compiler process failed');
        const evidence = {
            id: item.id,
            source_sha256: sha256(text),
            compiler_exit: compiled.status,
            guest_executed: false,
        };
        if (item.kind === 'guest') {
            assert.equal(compiled.status, 0, item.id + ': compiler error ' + compiled.stderr);
            assert.ok(existsSync(resultPath), item.id + ': no guest artifact');
            const wasm = readFileSync(resultPath);
            assert.ok(WebAssembly.validate(wasm), item.id + ': invalid guest wasm');
            const module = new WebAssembly.Module(wasm);
            assert.deepEqual(WebAssembly.Module.imports(module), [], item.id + ': guest has unexpected host imports');
            const instance = new WebAssembly.Instance(module, {});
            assert.equal(typeof instance.exports.main, 'function', item.id + ': no guest main export');
            const actual = instance.exports.main();
            assert.equal(actual, BigInt(item.expected.return_int), item.id + ': wrong guest result');
            assert.equal(instance.exports.panic_code.value, 0, item.id + ': guest panic');
            evidence.guest_executed = true;
            evidence.guest_return = actual.toString();
            evidence.guest_wasm_sha256 = sha256(wasm);
        } else {
            assert.equal(item.kind, 'compile_reject');
            const diagnostic = item.expected.diagnostic_class;
            // Semantic placeholders are NOT machine-stable diagnostics. The
            // checker and registry must first agree on an exact error code.
            assert.match(diagnostic, /^E_[A-Z_]+$/, item.id + ': no stable diagnostic code yet');
            assert.equal(compiled.status, 1, item.id + ': negative fixture did not fail compilation');
            assert.ok(!existsSync(resultPath), item.id + ': rejected program emitted an artifact');
            assert.ok(compiled.stderr.includes(diagnostic), item.id + ': wrong diagnostic ' + compiled.stderr);
            evidence.diagnostic_code = diagnostic;
        }
        report.source_fixtures.push(evidence);
    }
    console.log(JSON.stringify(report, null, 2));
    // Never rewrite cases.json status here. Independent column-address and
    // borrow-lifetime evidence is required to promote backend conformance.
} finally {
    rmSync(work, { recursive: true, force: true });
}
