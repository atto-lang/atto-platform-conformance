import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';

const base=new URL('../fixtures/mailbox-linearizability-v1/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const required=['ACTOR_SEND_STOP','ACTOR_INTERLEAVED_STOP','ACTOR_SEND_AFTER_STOP_REJECT'];
const backends=['java','llvm','wasm','net','forge'];
function gitBlob(bytes){
  const head=Buffer.from('blob '+bytes.length+'\0');
  return createHash('sha1').update(head).update(bytes).digest('hex');
}
test('canonical actor guest inventory is explicitly non-promoting',()=>{
  assert.equal(manifest.schema,'oreslang.mailbox_guest_fixture_inventory.v1');
  assert.equal(manifest.evidenceClassification,'CANONICAL_SOURCE_ONLY_NOT_RUNTIME_PROOF');
  assert.equal(manifest.originHead,'UNPINNED_FOR_EXECUTION_DO_NOT_TREAT_AS_PROVENANCE');
  assert.deepEqual(manifest.backends,backends);
  assert.equal(manifest.cases.length,3);
  assert.deepEqual(manifest.cases.map(x=>x.id),required);
  const unique=new Set();
  for(const f of manifest.cases){
    assert.match(f.path,/^source-actor-[a-z-]+\.ores$/);
    assert(!unique.has(f.path),'duplicate fixture path');unique.add(f.path);
    assert.match(f.gitBlobSha,/^[0-9a-f]{40}$/);
    assert(Object.keys(f.backendExecutionStatus).length===5);
    for(const b of backends)assert.equal(f.backendExecutionStatus[b],'NOT_EXECUTED');
    assert.equal(f.llvmExistingTestName,'source_actor_compiled_native_lifecycle');
  }
});
test('all three checked-in source bytes equal the precise original LLVM git blobs',()=>{
  const originals={
    'source-actor-send.ores':'3050260bd65b019a2b00191fba9086971409511b',
    'source-actor-interleaved-stop.ores':'c7488835f34e926dfa4c8766c8917301fe84da09',
    'source-actor-send-after-stop.ores':'ba046cb355fd16d9b5f6f7b39ace45356ef497db'
  };
  for(const f of manifest.cases){
    const url=new URL(f.path,base);
    assert(lstatSync(url).isFile(),'must not be symlink');
    const bytes=readFileSync(url);
    assert(bytes.length>0 && bytes.length<16384,'bounded source size');
    assert.equal(gitBlob(bytes),originals[f.path],f.path);
    assert.equal(f.gitBlobSha,originals[f.path],f.path);
  }
});
test('positive source and static rejection are not confused with mailbox traces',()=>{
  assert.equal(manifest.cases[0].expectedOutcome,'exit-43');
  assert.equal(manifest.cases[1].expectedOutcome,'exit-43');
  assert.equal(manifest.cases[2].expectedOutcome,'reject');
  assert.equal(manifest.cases[2].expectedLlvmDiagnostic,'actor message sent after stop');
  assert.equal(manifest.cases.some(x=>x.backendExecutionStatus.llvm==='PASS'),false);
});
