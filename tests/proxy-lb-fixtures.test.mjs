import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL(
  'fixtures/proxy-lb-v1/manifest.json',root),'utf8'));
const sig=/^fnc main\(\):int\{return ([0-9]+)\*([0-9]+)-([0-9]+)\*([0-9]+);\}\n$/;

test('five pinned scalar sources are byte-identical to manifest and satisfy bounded math',async()=>{
  assert.equal(manifest.schema,'oreslang.proxy_lb_scalar_fixture.v1');
  assert.deepEqual(manifest.profiles,
    ['java','llvm','wasm-core','cranelift','net-native-aot']);
  assert.equal(manifest.cases.length,5);
  const ids=new Set();
  for(const fixture of manifest.cases){
    assert.match(fixture.id,/^comparison-[a-z-]+$/);
    assert.equal(ids.has(fixture.id),false);ids.add(fixture.id);
    assert.equal(fixture.path,`fixtures/proxy-lb-v1/${fixture.id}.ores`);
    const source=await readFile(new URL(fixture.path,root));
    assert.ok(source.length<100,'fixture must be bounded and zero-import');
    const sha=createHash('sha1').update(`blob ${source.length}\0`)
      .update(source).digest('hex');
    assert.equal(sha,fixture.git_blob_sha);
    const matched=sig.exec(source.toString('utf8'));
    assert.ok(matched,'source must be a canonical zero-argument scalar fixture');
    const ints=matched.slice(1).map(Number);
    const actual=ints[0]*ints[1]-ints[2]*ints[3];
    assert.ok(Number.isSafeInteger(actual));
    assert.equal(actual,fixture.expected);
    assert.equal(fixture.guest_execution,'NOT_EXECUTED');
  }
});

test('source-free parity evidence cannot turn an unexecuted fixture into a PASS',async()=>{
  const status=JSON.parse(await readFile(new URL(
    'contracts/v1/proxy-lb/backend-status.pending.json',root),'utf8'));
  assert.equal(status.parity_certified,false);
  assert.equal(status.release_ready,false);
  assert.equal(status.backends.length,5);
  assert.deepEqual(status.backends.map(x=>x.backend),
    ['oreslang-source.java','oreslang-source.llvm',
     'oreslang-source.wasm','oreslang-source.cranelift',
     'oreslang-source.net']);
  assert.ok(status.backends.every(x=>x.guest_execution==='NOT_EXECUTED'));
  assert.equal(status.separate_backend_not_substitution.backend,'oreslang-source.forge');
});
