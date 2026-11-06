import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyManifestSecurityCI, githubReader } from '../bin/verify-manifest-security-ci.mjs';

const o = (char) => char.repeat(40);
const entries = [
  ['java','oreslang-source.java',1400792274,2573,'hardening/java-rust-manifest-file-boundary-20261106','f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2'],
  ['llvm','oreslang-source.llvm',1410897874,1446,'hardening/llvm-rust-manifest-file-boundary-20261106','f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2'],
  ['wasm','oreslang-source.wasm',1419858954,398,'hardening/wasm-rust-manifest-file-boundary-20261106','f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2'],
  ['net','oreslang-source.net',1419704375,373,'hardening/net-rust-manifest-file-boundary-20261106','f4dafa788f8a50565d5ded7d2cfb3911e40c8ae2'],
  ['forge','oreslang-source.forge',1419703674,197,'hardening/forge-manifest-parent-symlink-20261106','b954708b99de2c7ea71c1df4d0f65d9ddb057bb0'],
];
const step = (name) => ({ name, status: 'completed', conclusion: 'success' });
const fixture = () => {
  const receipt = {
    schema: 'atto.manifest-security-ci/1',
    candidates: entries.map(([backend,name,repository_id,pr],i)=>({
      backend, repository:`ores-truffle-oreslang/${name}`, repository_id, pr,
      head_sha: o('a'), tree_sha: o('b'), run_id: 12345+i, job_id: 54321+i,
    })),
  };
  const records = new Map();
  for (const [i, [backend,name,id,pr,base,blob]] of entries.entries()) {
    const r = receipt.candidates[i];
    const prefix=`/repos/ores-truffle-oreslang/${name}`;
    records.set(`${prefix}/pulls/${pr}`,{state:'open',head:{sha:r.head_sha,ref:`review/${name}`,repo:{id}},base:{ref:base,repo:{id}}});
    records.set(`${prefix}/commits/${r.head_sha}`,{sha:r.head_sha,commit:{tree:{sha:r.tree_sha}}});
    records.set(`${prefix}/contents/.github/workflows/integration-declarations.yml?ref=${r.head_sha}`,{sha:blob,type:'file'});
    records.set(`${prefix}/actions/workflows/integration-declarations.yml`,{id:9000+i,
      path:'.github/workflows/integration-declarations.yml',name:'Integration declaration integrity'});
    records.set(`${prefix}/actions/runs/${r.run_id}`,{id:r.run_id,repository:{id},head_repository:{id},
      head_sha:r.head_sha,head_branch:`review/${name}`,workflow_id:9000+i,
      name:'Integration declaration integrity',run_attempt:1,
      pull_requests:[{number:pr,head:{sha:r.head_sha}}],
      path:'.github/workflows/integration-declarations.yml',event:'pull_request',status:'completed',conclusion:'success'});
    records.set(`${prefix}/actions/runs/${r.run_id}/attempts/1/jobs?per_page=100`,
      {total_count:1,jobs:[{id:r.job_id}]});
    const steps = [step('Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'),
      step('Assert exact originating-source checkout')];
    if (backend!=='forge') steps.push(step('Test Rust repository policy tooling'));
    steps.push(step('Verify declaration-only manifest (not a runtime parity claim)'));
    if (backend==='forge') steps.push(step('Run fail-closed manifest gate adversarial regression suite'));
    records.set(`${prefix}/actions/jobs/${r.job_id}`,{id:r.job_id,run_id:r.run_id,
      head_sha:r.head_sha,name:'declaration-integrity',workflow_name:'Integration declaration integrity',
      labels:['ubuntu-24.04'],status:'completed',conclusion:'success',runner_id:8000+i,steps});
  }
  const api = async path => { if (!records.has(path)) throw new Error(`not found: ${path}`);return records.get(path); };
  const patch = (backend,kind,change) => {
    const i = entries.findIndex(v=>v[0]===backend);
    const r = receipt.candidates[i];
    const kindPath = kind==='pr'?`pulls/${r.pr}`:kind==='commit'?`commits/${r.head_sha}`:
      kind==='workflow'?`contents/.github/workflows/integration-declarations.yml?ref=${r.head_sha}`:
      kind==='registeredWorkflow'?'actions/workflows/integration-declarations.yml':
      kind==='attempt'?`actions/runs/${r.run_id}/attempts/1/jobs?per_page=100`:
      kind==='run'?`actions/runs/${r.run_id}`:`actions/jobs/${r.job_id}`;
    const path=`/repos/${r.repository}/${kindPath}`;
    change(records.get(path));
  };
  return { receipt, api, patch, records };
};

async function expectDeny(f, message) {
  const r = await qualifyManifestSecurityCI(f.receipt, f.api);
  assert.equal(r.ok,false,'must fail closed');
  assert.equal(r.status,'NOT_VERIFIED');
  assert.match(r.errors.join('\n'), message);
}

test('5/5 exact-head, source-owned stepful runs qualify as CI evidence only',async()=>{
  const f=fixture();const r=await qualifyManifestSecurityCI(f.receipt,f.api);
  assert.equal(r.ok,true,r.errors.join('\n'));assert.equal(r.qualifications.length,5);
  assert.equal(r.status,'CI_VERIFIED');
});
test('empty candidates are denied',async()=>{const f=fixture();f.receipt.candidates=[];await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/all five/);});
test('duplicate backend cannot replace another backend',async()=>{const f=fixture();f.receipt.candidates[4]={...f.receipt.candidates[0]};await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/duplicate backend/);});
test('prototype property does not resolve a backend',async()=>{const f=fixture();f.receipt.candidates[2].backend='__proto__';await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/unknown or duplicate/);});
test('repository name substitutions rejected before network use',async()=>{const f=fixture();f.receipt.candidates[1].repository='attacker/private-carrier';await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/repository ID/);});
test('repository numeric ID substitution rejected',async()=>{const f=fixture();f.receipt.candidates[0].repository_id=1;await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/repository ID/);});
test('wrong PR ID rejected',async()=>{const f=fixture();f.receipt.candidates[2].pr=999;await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/repository ID/);});
test('invalid SHA rejected',async()=>{const f=fixture();f.receipt.candidates[0].head_sha='A'.repeat(40);await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/invalid SHA/);});
test('unknown or missing fields denied',async()=>{const f=fixture();f.receipt.candidates[1].certified=true;await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/unexpected or missing keys/);});
test('stale PR head denied',async()=>{const f=fixture();f.patch('java','pr',d=>d.head.sha=o('c'));await expectDeny(f,/exact head/);});
test('wrong PR base denied',async()=>{const f=fixture();f.patch('java','pr',d=>d.base.ref='main');await expectDeny(f,/head\/base/);});
test('foreign head repo numeric identity denied',async()=>{const f=fixture();f.patch('llvm','pr',d=>d.head.repo.id=2);await expectDeny(f,/repository identity mismatch/);});
test('wrong commit tree denied',async()=>{const f=fixture();f.patch('wasm','commit',d=>d.commit.tree.sha=o('c'));await expectDeny(f,/source tree/);});
test('unreviewed workflow replacement denied',async()=>{const f=fixture();f.patch('net','workflow',d=>d.sha=o('c'));await expectDeny(f,/workflow blob mismatch/);});
test('workflow not a file denied',async()=>{const f=fixture();f.patch('forge','workflow',d=>d.type='dir');await expectDeny(f,/workflow blob mismatch/);});
test('zero-step job denied even if run and job say success',async()=>{const f=fixture();f.patch('java','job',d=>d.steps=[]);await expectDeny(f,/NOT_EXECUTED/);});
test('no runner assigned denied',async()=>{const f=fixture();f.patch('llvm','job',d=>d.runner_id=0);await expectDeny(f,/security job/);});
test('completed failing run is not passing',async()=>{const f=fixture();f.patch('net','run',d=>d.conclusion='failure');await expectDeny(f,/not a successful/);});
test('queued job is not evidence',async()=>{const f=fixture();f.patch('forge','job',d=>d.status='queued');await expectDeny(f,/security job/);});
test('run head mismatch denied',async()=>{const f=fixture();f.patch('java','run',d=>d.head_sha=o('c'));await expectDeny(f,/exact-head/);});
test('foreign repository run denied',async()=>{const f=fixture();f.patch('wasm','run',d=>d.repository.id=1);await expectDeny(f,/source-owned/);});
test('unrecognized workflow path denied',async()=>{const f=fixture();f.patch('net','run',d=>d.path='.github/workflows/fake.yml');await expectDeny(f,/source-owned/);});
test('workflow job id swapped denied',async()=>{const f=fixture();f.patch('net','job',d=>d.run_id=99);await expectDeny(f,/security job/);});
test('required Rust cargo test step missing denied',async()=>{const f=fixture();f.patch('java','job',d=>d.steps.splice(2,1));await expectDeny(f,/Test Rust/);});
test('required Forge adversarial step missing denied',async()=>{const f=fixture();f.patch('forge','job',d=>d.steps.pop());await expectDeny(f,/adversarial regression/);});
test('duplicate successful steps cannot confuse verifier',async()=>{const f=fixture();f.patch('wasm','job',d=>d.steps.push(step('Test Rust repository policy tooling')));await expectDeny(f,/duplicate/);});
test('failed required step denied even if job claims success',async()=>{const f=fixture();f.patch('llvm','job',d=>d.steps[2].conclusion='failure');await expectDeny(f,/not successful/);});
test('spoofed checkout step denied',async()=>{const f=fixture();f.patch('java','job',d=>d.steps[0].name='Run actions/checkout@main');await expectDeny(f,/pinned checkout/);});
test('network failures fail closed, not succeed',async()=>{const f=fixture();const r=await qualifyManifestSecurityCI(f.receipt,async()=>{throw Error('API unavailable')});assert.equal(r.ok,false);assert.equal(r.qualifications.length,0);});
test('missing token denies production reader',()=>assert.throws(()=>githubReader(''),/GITHUB_TOKEN required/));
test('non-GitHub API path denied',async()=>{const api=githubReader('not-real',async()=>{throw Error('should not call')});await assert.rejects(api('https://attacker.example'),/non-canonical/);});
test('HTTP failures deny qualification without returning secret',async()=>{const api=githubReader('PRIVATE_TOKEN',async()=>({ok:false,status:403}));await assert.rejects(api('/repos/ores-truffle-oreslang/x'),/HTTP 403/);});
test('oversized GitHub response denied',async()=>{
  const api=githubReader('PRIVATE_TOKEN',async()=>({ok:true,body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(512*1024+1));controller.close();}})}));
  await assert.rejects(api('/repos/ores-truffle-oreslang/x'),/exceeds/);
});

// Adversarial tests for live identity, attempt, and non-partial promotion semantics.
test('workflow identity cannot be substituted behind same job name',async()=>{
  const f=fixture();f.patch('net','registeredWorkflow',d=>d.name='Other workflow');await expectDeny(f,/registered workflow identity/);
});
test('run.workflow_id must be registered immutable workflow identity',async()=>{
  const f=fixture();f.patch('wasm','run',d=>d.workflow_id=2);await expectDeny(f,/source-owned/);
});
test('run must carry exact PR association',async()=>{
  const f=fixture();f.patch('java','run',d=>d.pull_requests=[]);await expectDeny(f,/associated with the exact PR head/);
});
test('run cannot refer to previous PR head',async()=>{
  const f=fixture();f.patch('llvm','run',d=>d.pull_requests[0].head.sha=o('d'));await expectDeny(f,/associated/);
});
test('run_attempt missing is a hard failure',async()=>{
  const f=fixture();f.patch('forge','run',d=>delete d.run_attempt);await expectDeny(f,/run_attempt/);
});
test('successful job from different attempt cannot attest current run',async()=>{
  const f=fixture();f.patch('forge','attempt',d=>d.jobs[0].id=999);await expectDeny(f,/latest completed run attempt/);
});
test('job attempt count over a page fails rather than hiding unknown jobs',async()=>{
  const f=fixture();f.patch('net','attempt',d=>d.total_count=101);await expectDeny(f,/latest completed run attempt/);
});
test('job name substitution denied',async()=>{
  const f=fixture();f.patch('java','job',d=>d.name='attacker-job');await expectDeny(f,/security job/);
});
test('runner label substitution denied',async()=>{
  const f=fixture();f.patch('llvm','job',d=>d.labels=['self-hosted']);await expectDeny(f,/security job/);
});
test('job SHA differs from verified exact head denied',async()=>{
  const f=fixture();f.patch('forge','job',d=>d.head_sha=o('e'));await expectDeny(f,/security job/);
});
test('duplicate checkout step denied',async()=>{
  const f=fixture();f.patch('java','job',d=>d.steps.push(step('Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683')));
  await expectDeny(f,/unique pinned checkout/);
});
test('partial backend successes are not emitted as verified qualifications',async()=>{
  const f=fixture();f.patch('forge','job',d=>d.steps=[]);
  const result=await qualifyManifestSecurityCI(f.receipt,f.api);
  assert.equal(result.ok,false);assert.deepEqual(result.qualifications,[]);
});
test('PR head moving during final recheck is denied',async()=>{
  const f=fixture();const key='/repos/ores-truffle-oreslang/oreslang-source.wasm/pulls/398';let visits=0;
  const api=async path=>{const val=await f.api(path);if(path===key && ++visits===2) return {...val,head:{...val.head,sha:o('e')}};return val;};
  const result=await qualifyManifestSecurityCI(f.receipt,api);
  assert.equal(result.ok,false);assert.deepEqual(result.qualifications,[]);
  assert.match(result.errors.join('\n'),/changed during evidence verification/);
});
test('run associated with unexpected branch is denied',async()=>{
  const f=fixture();f.patch('wasm','run',d=>d.head_branch='attacker');await expectDeny(f,/source-owned/);
});
test('run from different source head repo denied',async()=>{
  const f=fixture();f.patch('net','run',d=>d.head_repository.id=22);await expectDeny(f,/source-owned/);
});
test('null-byte field concatenation cannot bypass exactKeys',async()=>{
  const f=fixture();f.receipt.candidates[0]['run_id\0job_id']=1;
  await assert.rejects(qualifyManifestSecurityCI(f.receipt,f.api),/unexpected or missing keys/);
});
