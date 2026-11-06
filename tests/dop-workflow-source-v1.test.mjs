import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {requirePinnedDopWorkflow, validateWorkflowContentsObject,
  fetchAndValidatePinnedWorkflow} from '../verification/dop-workflow-source-v1.mjs';
const bytes = Buffer.from('name: synthetic-only\non: workflow_dispatch\n');
const blobSha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const policy = {path:'.github/workflows/synthetic.yml', blobSha};
const good = {path:policy.path,sha:blobSha,size:bytes.length,type:'file',encoding:'base64',
  content:bytes.toString('base64')};
const validate = patch => validateWorkflowContentsObject({...good,...patch},policy);

test('synthetic Git content object passes when exact bytes match its reviewed blob', () => {
  assert.deepEqual(validate({}),[]);
  assert.deepEqual(validate({content:good.content.slice(0,12)+'\n'+good.content.slice(12)}),[]);
});
test('PR workflow mutation with unchanged path/metadata is rejected', () => {
  const forged=Buffer.from('name: attacker\non: pull_request\n');
  assert.ok(validate({content:forged.toString('base64'),size:forged.length})
    .includes('workflow-source-content-hash'));
});
test('unreviewed workflow Git blob is rejected', () => {
  assert.ok(validate({sha:'c'.repeat(40)}).includes('workflow-source-review-blob'));
  assert.ok(validate({path:'other.yml'}).includes('workflow-source-path'));
});
test('directory, symlink, missing encoding and oversized source fail closed', () => {
  assert.ok(validate({type:'dir'}).includes('workflow-source-file-type'));
  assert.ok(validate({type:'symlink'}).includes('workflow-source-file-type'));
  assert.ok(validate({encoding:'none'}).includes('workflow-source-base64-encoding'));
  assert.ok(validate({size:65537}).includes('workflow-source-file-size'));
});
test('strict base64, correct declared size and actual content digest are required', () => {
  assert.ok(validate({content:'**'}).includes('workflow-source-invalid-base64'));
  assert.ok(validate({size:bytes.length+1}).includes('workflow-source-bytes-size'));
  assert.ok(validate({sha:blobSha,content:'YQ==',size:1}).includes('workflow-source-content-hash'));
});
test('canonical Java/LLVM source paths and reviewed candidate blob SHAs are pinned', () => {
  for (const [backend,repo,expectedSha] of [
    ['java','ores-truffle-oreslang/oreslang-source.java','1e7e45f5b1bb7151d375609fd1ae00d922509f96'],
    ['llvm','ores-truffle-oreslang/oreslang-source.llvm','a845d9f110940d8bf3da931c8bd52d021b7ffe6d']]) {
    const p=requirePinnedDopWorkflow(backend,repo,'a'.repeat(40));
    assert.equal(p.blobSha,expectedSha);
    assert.ok(p.path.startsWith('.github/workflows/'));
  }
});
test('wrong org, unregistered backend and invalid head are rejected before network', async () => {
  const calls = () => { throw new Error('network must not run'); };
  for(const args of [{backend:'java',repository:'foreign/fork',headSha:'a'.repeat(40)},
      {backend:'net',repository:'ores-truffle-oreslang/oreslang-source.net',headSha:'a'.repeat(40)},
      {backend:'java',repository:'ores-truffle-oreslang/oreslang-source.java',headSha:'abc'}]) {
    await assert.rejects(()=>fetchAndValidatePinnedWorkflow({...args,token:'token',fetchFn:calls}),
      /workflow-source-/);
  }
});
test('one read-only exact-head Contents API GET, no source export', async () => {
  const calls=[];
  const fetchFn=async (url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(good), {headers:{'content-type':'application/json'}})};
  const errors=await fetchAndValidatePinnedWorkflow({backend:'java',
    repository:'ores-truffle-oreslang/oreslang-source.java',headSha:'a'.repeat(40),
    token:'read-only-token',fetchFn});
  assert.ok(errors.includes('workflow-source-path'));
  assert.ok(errors.includes('workflow-source-review-blob'));
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/contents\/\.github\/workflows\/dop-scalar-java-guest.yml\?ref=a{40}$/);
  assert.equal(calls[0].opts.method,'GET');
  assert.equal(calls[0].opts.redirect,'manual');
});
