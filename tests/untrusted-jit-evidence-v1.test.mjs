import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateJitMatrix,inspectJitReceipt} from '../src/untrusted-jit-evidence-v1.mjs';
const matrix=JSON.parse(readFileSync(new URL('../contracts/untrusted-jit-adversarial-v1.json',import.meta.url),'utf8'));
const head='a'.repeat(40),tree='b'.repeat(40);
const base={caseId:'UJI-04',backend:'java',arch:'x86_64',sourceKind:'ATTO_SOURCE',
 executionClass:'REAL_ATTOLANG_GUEST_EXECUTED',headSha:head,treeSha:tree,
 imageSha256:'c'.repeat(64),engine:'Graal',engineVersion:'candidate',
 runnerId:123,jobId:456,steps:[{name:'compile-and-run',conclusion:'success'}],
 outcome:'PASS',neighborOutcome:'SURVIVED'};
const clone=x=>JSON.parse(JSON.stringify(x));
const check=(r,m=matrix)=>inspectJitReceipt(m,r,head,tree);
const deny=(name,fn,code)=>test(name,()=>{const r=clone(base);fn(r);assert.throws(()=>check(r),new RegExp(code));});
test('all five backends and 16 adversarial cases pending',()=>assert.equal(validateJitMatrix(matrix),true));
test('shape-valid observations never certify real guest execution',()=>{
 const result=check(base);assert.equal(result.certified,false);assert.equal(result.realGuestParityProven,false);
 assert.equal(result.status,'STRUCTURAL_ONLY_UNAUTHENTICATED');
});
test('low-level Wasm CVE tests cannot stand in for Atto source compiler passes',()=>{
 const r=clone(base);r.caseId='UJI-03';r.backend='wasm';r.arch='aarch64';
 assert.throws(()=>check(r),/SOURCE_BINARY_PROVENANCE_CONFLATED/);
 r.sourceKind='WASM_BINARY';r.executionClass='BACKEND_ADVERSARIAL_BINARY_EXECUTED';
 assert.equal(check(r).realGuestParityProven,false);
});
deny('zero-step CI not evidence',r=>r.steps=[],'ZERO_STEP_OR_UNADMITTED_RUN');
deny('no runner admission not evidence',r=>r.runnerId=0,'ZERO_STEP_OR_UNADMITTED_RUN');
deny('job id mandatory',r=>r.jobId=0,'ZERO_STEP_OR_UNADMITTED_RUN');
deny('failed step refused',r=>r.steps[0].conclusion='failure','FAILED_OR_EMPTY_STEP');
deny('incorrect SHA head refused',r=>r.headSha='d'.repeat(40),'UNPINNED_SOURCE_HEAD_OR_TREE');
deny('incorrect tree refused',r=>r.treeSha='d'.repeat(40),'UNPINNED_SOURCE_HEAD_OR_TREE');
deny('mutable/unknown image refused',r=>r.imageSha256='bad','UNPINNED_IMAGE');
deny('missing engine version refused',r=>r.engineVersion='','MISSING_ENGINE_VERSION');
deny('different backend refused',r=>r.backend='wasm','WRONG_BACKEND');
deny('source/binary conflation refused',r=>r.executionClass='BACKEND_ADVERSARIAL_BINARY_EXECUTED','SOURCE_BINARY_PROVENANCE_CONFLATED');
deny('neighbor compromised refused',r=>r.neighborOutcome='FAILED','UNPROVEN_NEIGHBOR');
deny('no asserted oracle refused',r=>r.outcome='UNKNOWN','UNPROVEN_TEST_ORACLE');
deny('forged success flag refused',r=>r.productionCertified=true,'INVALID_RECEIPT_FIELDS');
test('AArch64 case cannot pass x86_64 result',()=>{
 const r=clone(base);r.caseId='UJI-03';r.backend='wasm';
 assert.throws(()=>check(r),/WRONG_ARCH/);
});
test('manifest cannot assert a backend passed',()=>{
 const m=clone(matrix);m.backendStatus.wasm='PASS';
 assert.throws(()=>validateJitMatrix(m),/FALSE_BACKEND_PASS/);
});
test('manifest cannot assert a case executed',()=>{
 const m=clone(matrix);m.cases[0].status='PASS';
 assert.throws(()=>validateJitMatrix(m),/FALSE_CASE_PASS/);
});
test('case deletion fails closed',()=>{
 const m=clone(matrix);m.cases.pop();
 assert.throws(()=>validateJitMatrix(m),/INVALID_CASE_COUNT/);
});
test('native format substitution fails closed',()=>{
 const m=clone(matrix);m.cases[0].sourceKind='NATIVE';
 assert.throws(()=>validateJitMatrix(m),/INVALID_SOURCE_KIND/);
});
