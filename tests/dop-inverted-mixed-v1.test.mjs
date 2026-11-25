// Source-only contract and provenance validation. NOT a real .atto compile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(
    new URL('contracts/dop-inverted-mixed-v1/manifest.json',root),'utf8'));
const pair=JSON.parse(readFileSync(
    new URL('contracts/dop-inverted-bool-i64-v1/manifest.json',root),'utf8'));
const PINNED_BLOBS=Object.freeze({
  'positive-mixed-swap':'040c96b1380d29b1d7530d4413fff4f02e1a01d2',
  'positive-permuted-columns':'bd4356ed643a7b418d78c9447349a1dcaa52e282',
  'negative-stale-dense-index':'3693b7536da4891bfc980128211ec4834236a017',
  'negative-bool-as-int':'92eda107bcf7f543ca57ef5e143e49987bb59101',
  'negative-f64-from-int':'b541891a220af10efcf16be8977530aa79c16b62',
  'negative-immutable-bool-write':'58f964edb872ef6d6133e5ee2951935320a1c1cf',
  'negative-f64-return':'7937d1e303424166a01c092bfd8c97abf620482e',
  'negative-f64-infinite':'4d09aebe353a4b1fc78c9da5d6d3dcc54449c727'
});
const sha=(algo,buffer)=>createHash(algo).update(buffer).digest('hex');
const gitblob=buffer=>sha('sha1',Buffer.concat([
  Buffer.from('blob '+buffer.length+'\0','ascii'),buffer]));
const byId=Object.fromEntries(manifest.cases.map(x=>[x.id,x]));
const source=id=>readFileSync(new URL(byId[id].file,root),'utf8');

test('canonical mixed spec retains immutable source origin and explicit nonexecution',()=>{
  assert.equal(manifest.contract,'attolang.dop.inverted-mixed-i64-bool-f64-guest-v1');
  assert.equal(manifest.llvm_origin_repository,'ores-truffle-oreslang/oreslang-source.llvm');
  assert.equal(manifest.llvm_origin_pr,1488);
  assert.equal(manifest.llvm_origin_head,'3d88e15b4340227ca74c137f67b6004897a40fc5');
  assert.equal(manifest.llvm_unified_emitter_pr,1497);
  assert.equal(manifest.guest_execution,'NOT_EXECUTED');
  assert.equal(manifest.evidence_class,'SOURCE_COPY_VERIFIED_ONLY');
  assert.equal(pair.guest_execution??pair.actual_guest_execution,'NOT_EXECUTED');
  assert.deepEqual(Object.keys(manifest.backend_status).sort(),[
    'dotnet-nativeaot','forge-cranelift','java-graalvm','llvm','wasm']);
  assert.ok(Object.values(manifest.backend_status).every(s=>s==='NOT_EXECUTED'));
  assert.ok(Object.values(pair.backend_status).every(s=>s==='NOT_EXECUTED'));
});

test('all eight canonical .atto sources match independent pinned Git blobs and SHA-256',()=>{
  assert.equal(manifest.cases.length,8);
  assert.equal(new Set(manifest.cases.map(x=>x.id)).size,8);
  assert.deepEqual(Object.keys(byId).sort(),Object.keys(PINNED_BLOBS).sort());
  for(const c of manifest.cases){
    assert.equal(c.file,'fixtures/dop-inverted-mixed-v1/'+c.id+'.atto');
    assert.equal(c.git_blob_sha1,PINNED_BLOBS[c.id]);
    assert.match(c.source_sha256,/^[0-9a-f]{64}$/);
    const address=new URL(c.file,root);
    assert.equal(lstatSync(address).isSymbolicLink(),false);
    const bytes=readFileSync(address);
    assert.ok(bytes.length>0 && bytes.length<=65536);
    assert.equal(gitblob(bytes),PINNED_BLOBS[c.id]);
    assert.equal(sha('sha256',bytes),c.source_sha256);
    assert.match(bytes.toString('utf8'),/define inverted struct Particle as/);
    assert.match(bytes.toString('utf8'),/fnc main\(\): int/);
  }
});

test('combined two- and three-column corpora keep distinct executable outcomes',()=>{
  assert.deepEqual(manifest.scalar_fields,['i64','bool','f64']);
  assert.deepEqual(manifest.optimization_levels,['-O0','-O2']);
  assert.equal(manifest.expected_native_exit_runs,4);
  assert.equal(manifest.expected_native_signal_runs,2);
  assert.equal(manifest.expected_compile_rejections,5);
  assert.equal(manifest.cases.filter(x=>x.kind==='native_exit').length,2);
  assert.equal(manifest.cases.filter(x=>x.kind==='native_signal').length,1);
  assert.equal(manifest.cases.filter(x=>x.kind==='compiler_reject').length,5);
  assert.equal(pair.cases.length,8);
  assert.equal(pair.expected_native_exit_runs,4);
  assert.equal(pair.expected_native_signal_runs,2);
  assert.equal(pair.expected_compile_rejections,5);
  assert.equal(manifest.expected_native_exit_runs+pair.expected_native_exit_runs,8);
  assert.equal(manifest.expected_native_signal_runs+pair.expected_native_signal_runs,4);
  assert.equal(manifest.expected_compile_rejections+pair.expected_compile_rejections,10);
  for(const c of manifest.cases){
    if(c.kind==='native_exit')assert.equal(c.exit_code,42);
    else if(c.kind==='native_signal')assert.equal(c.expectation,'SIGILL_OR_SIGTRAP');
    else assert.ok(c.kind==='compiler_reject' && c.expectation.length>0);
  }
});

test('source text contains typed mutation, f64 signbit and explicit rejected conversions',()=>{
  assert.match(source('positive-mixed-swap'),/rows\.set\(1, energy, 3\.75\)/);
  assert.match(source('positive-mixed-swap'),/rows\.erase_swap\(0\)/);
  const permuted=source('positive-permuted-columns');
  assert.ok(permuted.indexOf('alive: bool')<permuted.indexOf('let energy: f64'));
  assert.ok(permuted.indexOf('let energy: f64')<permuted.indexOf('let id: int'));
  assert.match(permuted,/rows\.push\(true, -0\.0, 7\)/);
  assert.match(source('negative-stale-dense-index'),/rows\.get\(1, x\)/);
  assert.match(source('negative-bool-as-int'),/rows\.push\(42, 1, 1\.5\)/);
  assert.match(source('negative-f64-from-int'),/rows\.push\(42, true, 7\)/);
  assert.match(source('negative-immutable-bool-write'),/rows\.set\(0, alive, false\)/);
  assert.match(source('negative-f64-return'),/return rows\.get\(0, energy\)/);
  assert.match(source('negative-f64-infinite'),/1e309/);
});

test('adversarial single-byte fixture alteration changes both digests',()=>{
  for(const c of manifest.cases){
    const altered=Buffer.from(readFileSync(new URL(c.file,root)));
    const index=altered.indexOf(Buffer.from('fnc main'));
    assert.ok(index>=0);
    altered[index]^=1;
    assert.notEqual(gitblob(altered),c.git_blob_sha1);
    assert.notEqual(sha('sha256',altered),c.source_sha256);
  }
});
