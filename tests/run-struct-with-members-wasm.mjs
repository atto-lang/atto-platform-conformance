// Execute shared exact source text using a real, separately built Atto compiler.
// Negative diagnostics are admission-only: category labels are normative
// targets, not certified unless a backend-specific category oracle is added.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, stat, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';

assert.ok(process.env.ATTOC, 'ATTOC must identify the real built compiler');
const compiler = resolve(process.env.ATTOC);
const registry = JSON.parse(await readFile(new URL('../contracts/struct-with-members-conformance-v1.json', import.meta.url), 'utf8'));
assert.equal(registry.schema, 'atto.struct.with.members.conformance.v1');
assert.equal(registry.cases.length, 40);
const work = await mkdtemp(join(tmpdir(), 'atto-struct-portable-'));
const receipt = { positive: 0, negative_no_artifact: 0, category_verified: 0 };
try {
    for (const fixture of registry.cases) {
        assert.match(fixture.id, /^[a-z0-9-]+$/);
        const input = join(work, fixture.id + '.atto');
        const output = join(work, fixture.id + '.wasm');
        await writeFile(input, fixture.source, {flag: 'wx'});
        const build = spawnSync(compiler, [input, '-o', output], {encoding:'utf8', timeout:30000});
        assert.ifError(build.error);
        assert.equal(build.signal, null, fixture.id + ': compiler terminated');
        if (fixture.expect === 'reject') {
            assert.equal(build.status, 1, fixture.id + ': must reject with compiler diagnostic');
            assert.match(build.stderr, /E_[A-Z_]+/, fixture.id);
            await assert.rejects(stat(output), {code:'ENOENT'}, fixture.id);
            if (fixture.expected_code) {
                assert.match(fixture.expected_code, /^E_[A-Z_]+$/);
                const codes = [...build.stderr.matchAll(/(?:^|\s)(E_[A-Z_]+):/gm)].map(m => m[1]);
                assert.equal(codes[0], fixture.expected_code, fixture.id + ': primary diagnostic code');
                receipt.category_verified++;
            }
            receipt.negative_no_artifact++;
            console.log('PORTABLE_REJECT_NO_ARTIFACT', fixture.id, JSON.stringify(build.stderr.trim()));
            continue;
        }
        assert.equal(fixture.expect, 'accept');
        assert.equal(build.status, 0, fixture.id + ': ' + build.stderr);
        const bytes = await readFile(output);
        const module = new WebAssembly.Module(bytes);
        assert.ok(WebAssembly.Module.imports(module).every(i =>
            i.module === 'atto' && ['print_i64','print_bool','print_newline'].includes(i.name)), fixture.id);
        assert.ok(WebAssembly.Module.exports(module).every(e => e.kind !== 'memory' && !e.name.startsWith('$struct_')), fixture.id);
        let stdout = '';
        const instance = new WebAssembly.Instance(module, {atto:{
            print_i64: n => { stdout += String(n); },
            print_bool: n => { stdout += n ? 'true' : 'false'; },
            print_newline: () => { stdout += '\n'; }
        }});
        assert.equal(instance.exports.main(), BigInt(fixture.expected_exit), fixture.id);
        assert.equal(instance.exports.panic_code.value, 0, fixture.id);
        assert.equal(stdout, fixture.expected_stdout, fixture.id);
        receipt.positive++;
        console.log('PORTABLE_ACTUAL_GUEST', fixture.id, JSON.stringify(stdout));
    }
    assert.equal(receipt.positive, 14);
    assert.equal(receipt.negative_no_artifact, 26);
    assert.equal(receipt.category_verified, 9);
    console.log('PORTABLE_STRUCT_RECEIPT', JSON.stringify(receipt));
} finally {
    await rm(work, {recursive:true, force:true});
}
