import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKENDS,CASE_IDS,validateTheaterContract,validateGuestReceipt,auditParityIndex}
  from '../bin/verify-atto-theater-v1.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const contract=JSON.parse(fs.readFileSync(path.resolve(dir,'../contracts/atto-theater-v1.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.resolve(dir,'../verification/atto-theater-v1.receipts.json'),'utf8'));
const sha40='a'.repeat(40),sha64='b'.repeat(64);
const candidate=(backend='java')=>({
  schema:'atto.theater-guest-receipt/1',backend,repository:`atto-lang/atto-source.${backend}`,
  compiler:{sourceHeadSha:sha40,sourceTreeSha:sha40,binarySha256:sha64,mode:'native-aot'},
  fixture:{gitBlobSha:sha40,sourceSha256:sha64,language:'atto'},
  run:{id:123,jobId:456,runnerId:789,status:'completed',conclusion:'success',
    executedSteps:5,headSha:sha40,url:`https://github.com/atto-lang/atto-source.${backend}/actions/runs/123`},
  guest:{compilerGenerated:true,executedOnTarget:true,hostModelOnly:false,
    cases:CASE_IDS.map(id=>({id,status:'pass',mode:'compiled-guest',assertions:1}))}
});
const reject=(label,modify)=>test(`reject ${label}`,()=>{
  const r=candidate();modify(r);const x=validateGuestReceipt(r,contract);
  assert.equal(x.status,'rejected');assert.ok(x.errors.length>0);
});
test('contract fixes all 11 repositories and 28 safety cases',()=>{
  assert.deepEqual(validateTheaterContract(contract),[]);
  assert.equal(BACKENDS.length,11);assert.equal(CASE_IDS.length,28);
  assert.ok(contract.cases.some(c=>c.id==='ensemble-membership-is-not-subscription'));
  assert.ok(contract.cases.some(c=>c.id==='director-panic-control-only'));
});
test('empty index reports all backends not-executed and never certified',()=>{
  const x=auditParityIndex(index,contract);
  assert.equal(x.status,'not-certified');
  assert.equal(Object.keys(x.backends).length,11);
  assert.ok(Object.values(x.backends).every(v=>v.status==='not-executed'));
});
test('even complete synthetic candidate is never independently certified',()=>{
  for(const backend of BACKENDS){
    const r=candidate(backend);
    assert.equal(validateGuestReceipt(r,contract).status,'candidate-only');
    const x=auditParityIndex({schema:index.schema,receipts:[r]},contract);
    assert.equal(x.status,'not-certified');
    assert.equal(x.backends[backend].status,'candidate-only');
  }
});
reject('host model only',r=>r.guest.hostModelOnly=true);
reject('parser-only fixture',r=>r.guest.executedOnTarget=false);
reject('not compiler generated',r=>r.guest.compilerGenerated=false);
reject('failed CI',r=>r.run.conclusion='failure');
reject('queued CI',r=>r.run.status='queued');
reject('no executed job steps',r=>r.run.executedSteps=0);
reject('missing runner identity',r=>r.run.runnerId=null);
reject('unrelated green workflow URL',r=>r.run.url='https://github.com/other/repo/actions/runs/123');
reject('different source HEAD',r=>r.run.headSha='c'.repeat(40));
reject('uppercase source SHA',r=>r.compiler.sourceHeadSha='A'.repeat(40));
reject('wrong repository',r=>r.repository='atto-lang/atto-source.llvm');
reject('wrong language',r=>r.fixture.language='ores');
reject('missing fixture source blob',r=>r.fixture.gitBlobSha=null);
reject('missing runtime output',r=>r.guest.cases=[]);
reject('skipped negative case',r=>r.guest.cases[4].status='skipped');
reject('host-only negative case',r=>r.guest.cases[4].mode='host-model');
reject('case with zero assertions',r=>r.guest.cases[4].assertions=0);
reject('duplicated case with missing safety invariant',r=>r.guest.cases[4]={...r.guest.cases[3]});
reject('invented extra case',r=>r.guest.cases.push({id:'forged',status:'pass',mode:'compiled-guest',assertions:1}));
reject('invalid compiler binary digest',r=>r.compiler.binarySha256='0');
reject('unrecognized backend',r=>{r.backend='unknown';r.repository='atto-lang/atto-source.unknown'});
test('corrupt contract cannot remove a backend',()=>{
  const bad=structuredClone(contract);delete bad.backends.hdl;
  assert.ok(validateTheaterContract(bad).length>0);
  assert.equal(validateGuestReceipt(candidate(),bad).status,'rejected');
});
test('corrupt contract cannot silently remove a supervisor/ensemble case',()=>{
  const bad=structuredClone(contract);bad.cases.splice(4,1);
  assert.ok(validateTheaterContract(bad).length>0);
});
test('duplicate backend reports invalid-evidence instead of overwriting',()=>{
  const r=candidate();const x=auditParityIndex({schema:index.schema,receipts:[r,r]},contract);
  assert.equal(x.status,'invalid-evidence');
});
test('malformed/unknown backend index is invalid',()=>{
  for(const input of [{schema:index.schema,receipts:null},
    {schema:index.schema,receipts:[{...candidate(),backend:'unknown'}]}])
    assert.notEqual(auditParityIndex(input,contract).status,'not-certified');
});

test('contract cannot downgrade negative safety cases or swap subsystem ownership',()=>{
  const bad=structuredClone(contract);bad.cases[4].kind='positive';
  assert.ok(validateTheaterContract(bad).length>0);
  const shifted=structuredClone(contract);shifted.cases[4].subsystem='ensemble';
  assert.ok(validateTheaterContract(shifted).length>0);
});
test('contract cannot remove mandatory evidence requirements',()=>{
  const bad=structuredClone(contract);bad.requiredEvidence.splice(4,1);
  assert.ok(validateTheaterContract(bad).length>0);
  assert.equal(validateGuestReceipt(candidate(),bad).status,'rejected');
});
test('mandatory ensemble share! and typed try_publish cases cannot be deleted or downgraded',()=>{
  assert.equal(contract.cases.length,28);
  assert.equal(contract.ensemblePublication.source,'val receipt = topic.try_publish(share! event)?');
  assert.equal(contract.ensemblePublication.legacyOperand,'rt share event');
  assert.equal(contract.ensemblePublication.targetStatus,'NOT_EXECUTED');
  for(const id of [
    'ensemble-share-bang-checked','ensemble-share-bang-reject',
    'ensemble-try-publish-typed-receipt','ensemble-try-publish-full-rollback',
    'ensemble-try-publish-authentication','ensemble-dedicated-subscription-order',
    'ensemble-result-question-cleanup','ensemble-unsupported-guest-denial'
  ]) assert.ok(CASE_IDS.includes(id),id);
  const erased=structuredClone(contract);erased.cases.pop();
  assert.ok(validateTheaterContract(erased).length>0);
  const downgraded=structuredClone(contract);downgraded.cases[23].kind='positive';
  assert.ok(validateTheaterContract(downgraded).length>0);
  const aliasChanged=structuredClone(contract);
  aliasChanged.ensemblePublication.source='val receipt = topic.publish(rt share event)';
  assert.ok(validateTheaterContract(aliasChanged).length>0);
});
test('existing guest receipt candidates cannot pass with only the earlier twenty cases',()=>{
  const oldCaseReceipt=candidate();
  oldCaseReceipt.guest.cases=oldCaseReceipt.guest.cases.slice(0,20);
  assert.equal(validateGuestReceipt(oldCaseReceipt,contract).status,'rejected');
  assert.equal(auditParityIndex({schema:index.schema,receipts:[oldCaseReceipt]},contract).status,'invalid-evidence');
});

test('completely malformed contract fails closed instead of throwing',()=>{
  assert.deepEqual(validateGuestReceipt(candidate(),null),
    {status:'rejected',errors:['invalid contract identity']});
});
