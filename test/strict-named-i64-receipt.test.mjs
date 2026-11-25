import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONTRACT_GIT_BLOB,REPOS,canonicalContract,validateContractBytes,
  oracle,guestSource,verifyReceipt,compareReceipts} from '../bin/verify-strict-named-i64.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const contract=canonicalContract();
const raw=readFileSync(resolve(root,'contracts/strict-named-i64-v1.json'));
const digest=x=>createHash('sha256').update(x).digest('hex');
const SHA40='a'.repeat(40),SHA64='b'.repeat(64);
function synthetic(backend='java'){
  const repository=REPOS[backend];
  return {
    schema:'oreslang.strict-named-i64.receipt/1',status:'EXECUTED',backend,repository,
    contractGitBlob:CONTRACT_GIT_BLOB,contractSha256:contract.sha256,
    sourceCommit:SHA40,compilerCommit:SHA40,compilerBinarySha256:SHA64,
    guestArtifactSha256:SHA64,executionMode:'guest-runtime',
    evidence:{
      runId:12,jobId:14,runAttempt:1,
      runUrl:'https://github.com/'+repository+'/actions/runs/12',
      exactHead:true,workflowHeadSha:SHA40,
      runnerId:33,runnerName:'SYNTHETIC TEST ONLY',
      workflowConclusion:'success',executedSteps:2,
      steps:[{name:'synthetic compile',conclusion:'success'},
             {name:'synthetic execute',conclusion:'success'}],
      guestExecuted:true,hostStub:false,compilerProduced:true,logsSha256:SHA64
    },
    cases:contract.data.cases.map(v=>({
      id:v.id,guestSourceSha256:digest(Buffer.from(guestSource(v))),observed:oracle(v)
    }))
  };
}
function fail(receipt,expected){
  const result=verifyReceipt(receipt,contract);
  assert.equal(result.ok,false,'expected rejection');
  assert.match(result.errors.join('; '),expected);
}
test('26 canonical vectors match exact parent Java #2641 Git blob',()=>{
  assert.equal(contract.gitBlob,'3f65f557f06e8cd0d34a738a0d357d6c2e477665');
  assert.equal(contract.sha256,'dacca2eaf503f854fd7f60ba135ff31b6c210d90aff8d117d4dedb5b88bedec5');
  assert.equal(contract.data.cases.length,26);
  assert.equal(new Set(contract.data.cases.map(v=>v.id)).size,26);
  assert.deepEqual([...new Set(contract.data.cases.map(v=>v.operation))],
    ['rem','mod','pow','bit_xor']);
  assert.equal(contract.data.cases.filter(v=>v.expect.error).length,4);
});
test('all candidate sources preserve full signed-i64 stdout rather than exit code',()=>{
  for(const v of contract.data.cases){
    const source=guestSource(v);
    assert.match(source,/pub fnc main\(\): void/);
    assert.match(source,/stdio\.println\(Integer\./);
    assert.ok(source.includes(v.left)&&source.includes(v.right));
    assert.ok(!source.includes('main(): int'));
  }
});
test('reference semantics cover extremal modulus, negative exponent and overflow',()=>{
  assert.deepEqual(oracle({operation:'mod',left:'-1',right:'-9223372036854775808'}),
    {value:'9223372036854775807'});
  assert.deepEqual(oracle({operation:'pow',left:'-2',right:'63'}),
    {value:'-9223372036854775808'});
  assert.deepEqual(oracle({operation:'pow',left:'2',right:'63'}),{error:'OVERFLOW'});
  assert.deepEqual(oracle({operation:'pow',left:'2',right:'-1'}),{error:'NEGATIVE_EXPONENT'});
  assert.deepEqual(oracle({operation:'pow',left:'-1',right:'9223372036854775807'}),
    {value:'-1'});
  assert.deepEqual(oracle({operation:'rem',left:'-9',right:'4'}),{value:'-1'});
  assert.deepEqual(oracle({operation:'mod',left:'-9',right:'4'}),{value:'3'});
  assert.deepEqual(oracle({operation:'bit_xor',left:'-1',right:'0'}),{value:'-1'});
});
test('tampered, oversized and malformed contract is rejected',()=>{
  const mod=Buffer.from(raw);
  mod[mod.length-3]^=1;
  assert.equal(validateContractBytes(mod).ok,false);
  assert.equal(validateContractBytes(Buffer.alloc(65537)).ok,false);
  assert.equal(validateContractBytes(Buffer.from('{broken')).ok,false);
  const wrong=structuredClone(contract.data);
  wrong.cases[0].expect.value='42';
  assert.equal(validateContractBytes(Buffer.from(JSON.stringify(wrong))).ok,false);
});
test('missing, pending and zero-step receipts NEVER count as executed',()=>{
  fail(null,/missing executed/);
  for(const status of [undefined,null,'NOT_EXECUTED','PENDING','PASS']){
    fail({status,backend:'java'},/missing executed/);
  }
});
test('synthetic five-backend results are SHAPE_ONLY and NOT attestations',()=>{
  const all=Object.keys(REPOS).map(synthetic);
  for(const r of all){
    const out=verifyReceipt(r,contract);
    assert.equal(out.ok,true,out.errors.join('; '));
    assert.equal(out.status,'SHAPE_ONLY_NOT_ATTESTED');
  }
  const compared=compareReceipts(all,contract);
  assert.equal(compared.ok,true,compared.errors.join('; '));
  assert.equal(compared.status,'SHAPE_ONLY_NOT_ATTESTED');
});
test('five-backend parity comparison rejects missing or repeated backend',()=>{
  const all=Object.keys(REPOS).map(synthetic);
  assert.equal(compareReceipts(all.slice(0,4),contract).ok,false);
  const repeated=all.slice();repeated[4]=synthetic('java');
  assert.equal(compareReceipts(repeated,contract).ok,false);
});
test('unknown prototype names and wrong backend/repository cannot pass',()=>{
  for(const bad of ['constructor','toString','__proto__','valueOf','js','rs']){
    const r=synthetic();r.backend=bad;fail(r,/unknown backend/);
  }
  const r=synthetic();r.repository=REPOS.llvm;fail(r,/repository mismatch/);
});
test('source, compiler, artifact and manifest identities are mandatory',()=>{
  for(const key of ['contractGitBlob','contractSha256','sourceCommit',
    'compilerCommit','compilerBinarySha256','guestArtifactSha256']){
    const r=synthetic();r[key]='0';
    fail(r,/digest mismatch|invalid SHA/);
  }
});
test('run identity must match URL and compiler must come from exact backend head',()=>{
  const differentRun=synthetic();differentRun.evidence.runId=100;
  fail(differentRun,/runUrl repository\/runId mismatch/);
  const differentCompiler=synthetic();differentCompiler.compilerCommit='c'.repeat(40);
  fail(differentCompiler,/compiler source commit does not match exact backend head/);
});
test('source-owned workflow HEAD must be exact and explicitly asserted',()=>{
  for(const value of [undefined,null,false,'true',0]){
    const r=synthetic();r.evidence.exactHead=value;
    fail(r,/exactHead must be true/);
  }
  for(const value of [undefined,null,0,'A'.repeat(40),'c'.repeat(40)]){
    const r=synthetic();r.evidence.workflowHeadSha=value;
    fail(r,/workflowHeadSha must bind the exact sourceCommit/);
  }
  const r=synthetic();r.evidence.exactHead=true;r.evidence.workflowHeadSha=SHA40;
  const outcome=verifyReceipt(r,contract);
  assert.equal(outcome.ok,true,outcome.errors.join('; '));
  assert.equal(outcome.status,'SHAPE_ONLY_NOT_ATTESTED');
});
test('canonical checksum and JSON mutation are independently rejected',()=>{
  const modified=Buffer.from(raw);
  modified[modified.length-1]^=1;
  const rejected=validateContractBytes(modified);
  assert.equal(rejected.ok,false);
  assert.match(rejected.errors.join('; '),/canonical contract Git blob mismatch/);
  assert.match(rejected.errors.join('; '),/canonical contract SHA-256 mismatch/);
});
test('unassigned runners and empty/mismatched or failed steps cannot pass',()=>{
  for(const value of [0,-1,1.5,null,undefined,Number.MAX_SAFE_INTEGER+1]){
    const r=synthetic();r.evidence.runnerId=value;fail(r,/runnerId/);
    const s=synthetic();s.evidence.executedSteps=value;fail(s,/executedSteps|steps/);
  }
  for(const steps of [null,[],undefined,[{name:'one',conclusion:'success'}],
    [{name:'one',conclusion:'failure'},{name:'two',conclusion:'success'}]]){
    const r=synthetic();r.evidence.steps=steps;fail(r,/steps/);
  }
});
test('host-only claims, zero logs and foreign workflow urls are refused',()=>{
  for(const key of ['runnerName','logsSha256','workflowConclusion','hostStub',
    'guestExecuted','compilerProduced']){
    const r=synthetic();delete r.evidence[key];
    fail(r,/runnerName|logsSha256|workflow|host stub/);
  }
  for(const value of ['http://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/12',
    'https://github.com/attacker/repo/actions/runs/12',
    'https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/0']){
    const r=synthetic();r.evidence.runUrl=value;fail(r,/runUrl/);
  }
});
test('every observed case, ordering, guest source SHA and diagnostic must match',()=>{
  const miss=synthetic();miss.cases.pop();fail(miss,/incomplete/);
  const order=synthetic();[order.cases[0],order.cases[1]]=[order.cases[1],order.cases[0]];
  fail(order,/identity/);
  const sha=synthetic();sha.cases[0].guestSourceSha256='0'.repeat(64);
  fail(sha,/guest source digest/);
  const val=synthetic();val.cases[0].observed={value:'5'};fail(val,/observation/);
  const error=synthetic();error.cases[6].observed={error:'HOST_CRASH'};
  fail(error,/observation/);
  const mock=synthetic();mock.cases[0].observed={value:'1',hostStub:true};
  fail(mock,/observation/);
});
test('undeclared schema/evidence/case fields reject, not silently ignored',()=>{
  for(const level of ['receipt','evidence','case','step']){
    const r=synthetic();
    if(level==='receipt')r.fakeAttestation=true;
    if(level==='evidence')r.evidence.unsafeBypass=true;
    if(level==='case')r.cases[0].unknown=true;
    if(level==='step')r.evidence.steps[0].unknown=true;
    fail(r,/unknown|identity|observation|steps/);
  }
});
test('host AOT is not guest AOT; guest-aot label remains shape-only',()=>{
  const r=synthetic();r.executionMode='host-aot';fail(r,/unsupported guest/);
  r.executionMode='guest-aot';
  assert.equal(verifyReceipt(r,contract).status,'SHAPE_ONLY_NOT_ATTESTED');
});
