import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../', import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'contracts/adt-guard-parity-v1.json'),'utf8'));
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+String.fromCharCode(0))).update(bytes).digest('hex');
test('manifest preserves exact real Rust/Wasm source provenance without inventing JVM/LLVM/NET parity',()=>{
 assert.equal(manifest.schema,'attolang.adt-guard-parity.v1');
 assert.equal(manifest.parityCertified,false);
 assert.equal(manifest.canonical.commit,'e2d18c418c9d46dde3e7bf4b1936d39139ffefee');
 assert.equal(manifest.canonical.tree,'24035e0b26d52b56c770792cc7d6771e98262ec3');
 assert.equal(manifest.cases.length,24);
 assert.equal(manifest.cases.filter(x=>x.kind==='execute').length,12);
 assert.equal(manifest.cases.filter(x=>x.kind==='reject').length,12);
 for(const k of ['java','llvm','net'])assert.notMatch(manifest.backends[k].state,/^EXECUTED|^CERTIFIED/);
 assert.equal(manifest.backends.rust_wasm.state,'EXECUTED_CANONICAL_SUBSET');
});
test('24 original ADT guard fixture bytes, file modes and identifiers are immutable',async()=>{
 const paths=new Set(), ids=new Set();
 for(const c of manifest.cases){
   assert.match(c.id,/^adt-[a-z0-9-]+$/);
   assert.equal(ids.has(c.id),false,c.id);ids.add(c.id);
   assert.match(c.gitBlobSha1,/^[0-9a-f]{40}$/);
   assert.match(c.path,/^fixtures\/adt-guard-v1\/(?:pass|fail)\/adt-[a-z0-9-]+\.atto$/);
   assert.equal(paths.has(c.path),false,c.path);paths.add(c.path);
   assert.equal(c.kind,c.path.includes('/pass/')?'execute':'reject');
   assert.ok(c.invariant.length>10);
   const f=path.join(root,c.path);
   const st=await lstat(f);
   assert.ok(st.isFile()&&!st.isSymbolicLink());
   const bytes=await readFile(f);
   assert.ok(bytes.length>0&&bytes.length<=1_048_576,c.id);
   assert.equal(gitBlob(bytes),c.gitBlobSha1,c.path);
   const source=bytes.toString('utf8');
   assert.ok(source.includes(c.kind==='execute'?'// expect-exit:':'// expect-error:'),c.id);
   assert.equal(c.portability,(c.id==='adt-option-bool-unsupported'||c.id==='adt-result-int-error-unsupported')?'rust-profile-only':'portable-semantics');
 }
 for(const kind of ['pass','fail']){
   const dir=path.join(root,'fixtures/adt-guard-v1',kind);
   const disk=(await readdir(dir)).filter(n=>n.endsWith('.atto')).sort();
   const expected=manifest.cases.filter(c=>c.path.includes('/'+kind+'/')).map(c=>path.basename(c.path)).sort();
   assert.deepEqual(disk,expected,'extra, missing or swapped ADT fixture '+kind);
 }
});
test('negative evidence may not conflate unsupported source with semantic proof',()=>{
 const profiles=manifest.cases.filter(x=>x.portability==='rust-profile-only');
 assert.deepEqual(profiles.map(x=>x.id),['adt-option-bool-unsupported','adt-result-int-error-unsupported']);
 assert.ok(manifest.rules.some(s=>s.includes('syntax/unsupported failures are not negative parity evidence')));
 assert.equal(manifest.parityCertified,false);
});
