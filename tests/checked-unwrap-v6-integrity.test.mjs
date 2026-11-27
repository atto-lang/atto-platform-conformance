import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {verifyCheckedUnwrapManifest,verifyCheckout,parsePinnedCheckedUnwrapManifest} from '../bin/verify-checked-unwrap-v6.mjs';

const root=new URL('../fixtures/option-result-trap/v6/',import.meta.url);
const manifest=()=>JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const read=name=>readFileSync(new URL(name,root));
const names=readdirSync(root).filter(n=>n.endsWith('.atto'));
test('exact checked unwrap fixture corpus, not a guest receipt',()=>{
 assert.deepEqual(verifyCheckout(),{source_fixtures_verified:9,target_profiles:13,
  candidate_cells:117,guest_executions:0,evidence_kind:'SOURCE_INTEGRITY_ONLY'});
});
test('manifest cannot self-authorize weakened cases or fake execution',()=>{
 for(const mutate of [m=>m.status='PASS',m=>m.required_backends.pop(),m=>m.cases.pop(),
  m=>m.cases[0].expected.result=0,m=>m.cases[0].git_blob_sha1='0'.repeat(40),
  m=>m.cases[0].path='../escape.atto',m=>m.cases[3].expected={result:42}]){
  const m=manifest();mutate(m);
  assert.throws(()=>verifyCheckedUnwrapManifest(m,()=>{throw new Error('unexpected read');},names),
    /manifest differs/);
 }
});
test('missing, extra, modified and non-byte fixtures reject',()=>{
 assert.throws(()=>verifyCheckedUnwrapManifest(manifest(),read,names.slice(1)),/unregistered or missing/);
 assert.throws(()=>verifyCheckedUnwrapManifest(manifest(),read,[...names,'extra.atto']),/unregistered or missing/);
 assert.throws(()=>verifyCheckedUnwrapManifest(manifest(),name=>Buffer.concat([read(name),Buffer.from(' ')]),names),/blob drift/);
 assert.throws(()=>verifyCheckedUnwrapManifest(manifest(),()=>'',names),/invalid fixture bytes/);
});

test('serialized manifest rejects ambiguous duplicate keys and byte drift',()=>{
 const bytes=read('manifest.json');
 assert.deepEqual(parsePinnedCheckedUnwrapManifest(bytes),manifest());
 const text=bytes.toString('utf8');
 const duplicate=text.replace('"status": "AUTHORED_NOT_EXECUTED"', '"status": "PASS", "status": "AUTHORED_NOT_EXECUTED"');
 // The old JSON.parse + semantic deep equality accepted the ambiguous bytes.
 assert.notEqual(duplicate,text);
 assert.deepEqual(JSON.parse(duplicate),manifest());
 for(const mutant of [Buffer.from(duplicate),Buffer.concat([bytes,Buffer.from(' ')]),
   Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes])])
   assert.throws(()=>parsePinnedCheckedUnwrapManifest(mutant),/manifest blob drift/);
 assert.throws(()=>parsePinnedCheckedUnwrapManifest(text),/invalid manifest bytes/);
 assert.throws(()=>parsePinnedCheckedUnwrapManifest(new Uint8Array()),/invalid manifest bytes/);
});
