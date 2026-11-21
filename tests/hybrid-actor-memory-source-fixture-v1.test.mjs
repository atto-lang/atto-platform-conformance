import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Source fixture integrity ONLY. Actual Atto compiler and guest runtime
// execution remain independent per-backend acceptance requirements.
const base=new URL('../fixtures/hybrid-actor-memory-v1/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const canonical=readFileSync(new URL('node_graph.atto',base));
const negative=readFileSync(new URL('node_graph_wrong_assert.atto',base));
function git_blob_sha(buffer){
  return createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
}

test('shared .atto Node graph is byte-identical to the .NET guest fixture',()=>{
  assert.equal(manifest.schema_version,1);
  assert.equal(manifest.contract,'atto.hybrid-actor-memory.guest-fixtures.v1');
  assert.equal(manifest.status,'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.upstream.blob_sha,'d472cccb3da24ee8f9fed44f99c1c7742d3240de');
  assert.equal(git_blob_sha(canonical),manifest.upstream.blob_sha);
  assert.equal(git_blob_sha(canonical),manifest.cases[0].blob_sha);
  const source=canonical.toString('utf8');
  assert.match(source,/define class Node as/);
  assert.match(source,/Node\? next/);
  assert.match(source,/define actor HeapGraphProbe as/);
  assert.equal((source.match(/new Node\(/g)||[]).length,2);
  assert.match(source,/assert\(second\.next\?\.value == 42\)/);
});

test('negative fixture changes exactly one assertion and does not change native source',()=>{
  const original=canonical.toString('utf8');
  const wrong=negative.toString('utf8');
  assert.equal(wrong,original.replace('assert(second.next?.value == 42)',
      'assert(second.next?.value == 43)'));
  assert.notEqual(wrong,original);
  assert.equal(git_blob_sha(negative),manifest.cases[1].blob_sha);
  assert.notEqual(git_blob_sha(canonical),git_blob_sha(negative));
});

test('11-target compiled guest receipts remain empty until actual guest execution',()=>{
  const names=['java','llvm','net','forge','wasm','rs','cranelift','js','atto','hdl','realtime'];
  assert.deepEqual(Object.keys(manifest.backends).sort(),names.sort());
  assert.deepEqual(manifest.cases.map(c=>c.id),['node_graph_positive','node_graph_wrong_assert']);
  for(const [name,row] of Object.entries(manifest.backends)){
    assert.equal(row.repo,'atto-lang/atto-source.'+name);
    assert.equal(row.positive,'NOT_EXECUTED');
    assert.equal(row.negative,'NOT_EXECUTED');
    assert.equal(row.compiled_guest_receipt,null);
  }
  assert.equal(manifest.rules.length,6);
});
