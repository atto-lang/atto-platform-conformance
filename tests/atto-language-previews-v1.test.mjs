import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {validateAttoPreviewManifest, gitBlob} from '../lib/atto-language-previews-v1.mjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root,'contracts/atto-language-previews-v1/manifest.json'),'utf8'));
const copy = x => structuredClone(x);

test('Atto preview source contract has exact Git blobs, no backend parity receipts', () => {
  const evidence = validateAttoPreviewManifest(manifest,root);
  assert.equal(Object.keys(evidence).length,12);
  assert.equal(manifest.compiler_receipts.length,0);
  assert.equal(manifest.fixtures.filter(x=>x.kind==='REJECT').length,7);
  assert.equal(manifest.fixtures.filter(x=>x.kind==='ACCEPT').length,5);
});

test('guard has a failure block with NO else; negative cases prove the distinction', () => {
  const canonical = readFileSync(resolve(root,'fixtures/guard-v1/canonical-scalar.atto'),'utf8');
  const rejectElse = readFileSync(resolve(root,'fixtures/guard-v1/reject-else.atto'),'utf8');
  const rejectFallthrough = readFileSync(resolve(root,'fixtures/guard-v1/reject-fallthrough.atto'),'utf8');
  assert.match(canonical,/guard x > 0 \{/);
  assert.doesNotMatch(canonical,/guard[^\n]*else/);
  assert.match(rejectElse,/\} else \{/);
  assert.match(rejectFallthrough,/guard true \{ \}/);
});

test('routine contract distinguishes fnc recursion, routine direct and indirect cycles, callback escapes', () => {
  const read = n => readFileSync(resolve(root,'fixtures/atto-language-previews-v1/'+n+'.atto'),'utf8');
  assert.match(read('routine-direct'),/routine double\(/);
  assert.match(read('fnc-recursive'),/return climb\(value \+ 1\)/);
  assert.match(read('routine-self-reject'),/return self_cycle\(remaining - 1\)/);
  assert.match(read('routine-mutual-reject'),/routine enter[\s\S]*fnc hop[\s\S]*return enter\(/);
  assert.match(read('routine-value-reject'),/val callback = direct_only;/);
});

test('exports have canonical file-top and file-bottom source syntax, with kind and unbound negatives', () => {
  const read = n => readFileSync(resolve(root,'fixtures/atto-language-previews-v1/'+n+'.atto'),'utf8');
  const a=read('export-forward'),b=read('export-trailing-pkg');
  assert.ok(a.indexOf('export pub Foo;')<a.indexOf('define class Foo as'));
  assert.ok(b.indexOf('export pub[pkg] class Bar;')>b.indexOf('define class Bar as'));
  assert.match(read('export-kind-reject'),/export pub actor Foo;[\s\S]*define class Foo/);
  assert.match(read('export-unknown-reject'),/export pub Missing;/);
});

test('forgeable results cannot promote source-only evidence to compiler parity', () => {
  const broken=[
    {...copy(manifest),status:'VERIFIED'},
    {...copy(manifest),evidence_class:'GUEST_EXECUTED'},
    {...copy(manifest),compiler_receipts:[{passed:true}]},
    {...copy(manifest),backend_status:{...manifest.backend_status,java:'VERIFIED'}},
    {...copy(manifest),fixtures:manifest.fixtures.slice(1)},
    {...copy(manifest),fixtures:manifest.fixtures.map((f,i)=>i?f:{...f,git_blob:'0'.repeat(40)})},
    {...copy(manifest),fixtures:manifest.fixtures.map((f,i)=>i?f:{...f,path:'../outside.atto'})}
  ];
  for(const forged of broken)assert.throws(()=>validateAttoPreviewManifest(forged,root));
});

test('fixture tampering and symlinks fail the immutable Git blob gate',()=>{
  const temp=mkdtempSync(join(tmpdir(),'atto-preview-source-'));
  try{
    for(const name of ['contracts/guard-v1.json',...manifest.fixtures.map(x=>x.path)]){
      const dest=resolve(temp,name);
      mkdirSync(dirname(dest),{recursive:true});
      writeFileSync(dest,readFileSync(resolve(root,name)));
    }
    assert.deepEqual(validateAttoPreviewManifest(manifest,temp),validateAttoPreviewManifest(manifest,root));
    const p=resolve(temp,'fixtures/atto-language-previews-v1/routine-direct.atto');
    const original=readFileSync(p);
    assert.equal(gitBlob(original),manifest.fixtures.find(x=>x.id==='routine-direct').git_blob);
    writeFileSync(p,Buffer.concat([original,Buffer.from(' ')]));
    assert.throws(()=>validateAttoPreviewManifest(manifest,temp),/Git blob drift|Invalid fixture source/);
    writeFileSync(p,original);
    rmSync(p);
    symlinkSync(resolve(root,'fixtures/atto-language-previews-v1/routine-direct.atto'),p);
    assert.throws(()=>validateAttoPreviewManifest(manifest,temp),/Symlink fixture component/);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
