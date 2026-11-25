import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySourceOnlyArtifactBytes as verify} from '../verification/runner-evidence-artifact-bytes-v1.mjs';
const bytes = text => Buffer.from(text, 'utf8');
const hash = b => createHash('sha256').update(b).digest('hex');
const tap = n => bytes('TAP version 13\n' + Array.from({length:n},(_,i)=>'ok ' + (i+1) + ' - synthetic case ' + (i+1) + '\n').join('') + '1..' + n + '\n# tests ' + n + '\n# pass ' + n + '\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n');
function data() {
  const expected = {repo:'ores-truffle-oreslang/oreslang-platform-conformance',
    headSha:'a'.repeat(40),treeSha:'b'.repeat(40),runId:4422,attempt:2,
    jobName:'source-only-runner-receipt',baseCount:86,correlationCount:44,artifactCount:37};
  const baseTapBytes=tap(86),correlationTapBytes=tap(44),artifactTapBytes=tap(37);
  const receipt={classification:'SOURCE_ONLY_NODE_TEST_EXECUTED_NOT_GUEST_PARITY',
    hosted_api_independent_job_step_correlation:'NOT_PERFORMED',
    repo:expected.repo,head:expected.headSha,tree:expected.treeSha,
    run_id:'4422',run_attempt:'2',job:expected.jobName,
    test_count:86,correlation_test_count:44,artifact_bytes_test_count:37,
    tap_sha256:hash(baseTapBytes),correlation_tap_sha256:hash(correlationTapBytes),
    artifact_bytes_tap_sha256:hash(artifactTapBytes),
    not_proven:['native compilation','guest execution','backend parity','merge approval']};
  return {expected,receipt,baseTapBytes,correlationTapBytes,artifactTapBytes};
}
const check=v=>verify({receiptBytes:bytes(JSON.stringify(v.receipt)+'\n'),
  baseTapBytes:v.baseTapBytes,correlationTapBytes:v.correlationTapBytes,
  artifactTapBytes:v.artifactTapBytes,expected:v.expected});
const reject=(name,change,code)=>test(name,()=>{
  const v=data();change(v);assert.throws(()=>check(v),new RegExp(code));
});
test('downloaded synthetic bytes match but cannot attest runner or guest',()=>{
  const o=check(data());
  assert.equal(o.baseTestCount,86);assert.equal(o.correlationTestCount,44);
  assert.equal(o.artifactTestCount,37);
  assert.equal(o.hostedRunnerVerified,false);assert.equal(o.guestExecutionProven,false);
  assert.equal(o.mergeAuthorized,false);
});
reject('receipt wrong source head',v=>v.receipt.head='c'.repeat(40),'E_RECEIPT_IDENTITY');
reject('receipt wrong tree',v=>v.receipt.tree='c'.repeat(40),'E_RECEIPT_IDENTITY');
reject('receipt wrong run attempt',v=>v.receipt.run_attempt='1','E_RECEIPT_IDENTITY');
reject('receipt wrong run id',v=>v.receipt.run_id='4423','E_RECEIPT_IDENTITY');
reject('receipt wrong job',v=>v.receipt.job='another','E_RECEIPT_IDENTITY');
reject('receipt foreign repo',v=>v.receipt.repo='other/private','E_RECEIPT_IDENTITY');
reject('receipt base test count substituted',v=>v.receipt.test_count=85,'E_TEST_INVENTORY');
reject('receipt artifact test count substituted',v=>v.receipt.artifact_bytes_test_count=36,'E_TEST_INVENTORY');
reject('receipt correlation test count substituted',v=>v.receipt.correlation_test_count=43,'E_TEST_INVENTORY');
reject('forged guest claim',v=>v.receipt.guestTestsExecuted=true,'E_RECEIPT_FIELDS');
reject('forged approval claim',v=>v.receipt.mergeAuthorized=true,'E_RECEIPT_FIELDS');
reject('claimed attested origin',v=>v.receipt.hosted_api_independent_job_step_correlation='PASS','E_RECEIPT_CLASS');
reject('missing excluded proof class',v=>v.receipt.not_proven.pop(),'E_NON_PROMOTION');
reject('tampered base digest',v=>v.receipt.tap_sha256='f'.repeat(64),'E_ARTIFACT_DIGEST');
reject('tampered artifact digest',v=>v.receipt.artifact_bytes_tap_sha256='f'.repeat(64),'E_ARTIFACT_DIGEST');
reject('tampered correlation digest',v=>v.receipt.correlation_tap_sha256='f'.repeat(64),'E_ARTIFACT_DIGEST');
reject('corrupted base artifact bytes',v=>v.baseTapBytes=Buffer.concat([v.baseTapBytes,bytes('extra')]),'E_ARTIFACT_DIGEST');
reject('corrupted artifact test bytes',v=>v.artifactTapBytes=Buffer.concat([v.artifactTapBytes,bytes('extra')]),'E_ARTIFACT_DIGEST');
reject('corrupted correlation artifact bytes',v=>v.correlationTapBytes=Buffer.concat([v.correlationTapBytes,bytes('extra')]),'E_ARTIFACT_DIGEST');
reject('missing TAP count',v=>v.baseTapBytes=bytes(tap(86).toString().replace('# tests 86\n','')),'E_TAP_SUMMARY');
reject('missing individual test records',v=>v.baseTapBytes=bytes(tap(86).toString().replace('ok 1 - synthetic case 1\n','')),'E_TAP_CASES');
reject('duplicate individual test number',v=>v.baseTapBytes=bytes(tap(86).toString().replace('ok 2 - synthetic case 2','ok 1 - synthetic case 2')),'E_TAP_CASES');
reject('missing TAP plan',v=>v.baseTapBytes=bytes(tap(86).toString().replace('1..86\n','')),'E_TAP_PLAN');
reject('swapped TAP plan',v=>v.baseTapBytes=bytes(tap(86).toString().replace('1..86','1..85')),'E_TAP_PLAN');
reject('duplicated TAP count',v=>v.baseTapBytes=Buffer.concat([v.baseTapBytes,bytes('# tests 86\n')]),'E_TAP_SUMMARY');
reject('skipped synthetic test',v=>v.baseTapBytes=bytes(tap(86).toString().replace('# skipped 0','# skipped 1')),'E_TAP_SUMMARY');
reject('failed synthetic test',v=>v.baseTapBytes=Buffer.concat([v.baseTapBytes,bytes('not ok 1 - fake\n')]),'E_TAP_FAILURE');
reject('base TAP missing todo count',v=>v.baseTapBytes=bytes(tap(86).toString().replace('# todo 0\n','')),'E_TAP_SUMMARY');
reject('artifact TAP missing todo count',v=>v.artifactTapBytes=bytes(tap(37).toString().replace('# todo 0\n','')),'E_TAP_SUMMARY');
reject('correlation TAP missing todo count',v=>v.correlationTapBytes=bytes(tap(44).toString().replace('# todo 0\n','')),'E_TAP_SUMMARY');
reject('invalid pinned expected count',v=>v.expected.baseCount=0,'E_TEST_INVENTORY');
reject('invalid pinned expected head',v=>v.expected.headSha='invalid','E_RECEIPT_IDENTITY');
test('reject empty artifact bytes',()=>{
  const v=data();assert.throws(()=>verify({receiptBytes:bytes(JSON.stringify(v.receipt)),
    baseTapBytes:Buffer.alloc(0),correlationTapBytes:v.correlationTapBytes,artifactTapBytes:v.artifactTapBytes,expected:v.expected}),/E_BYTES/);
});
test('reject invalid JSON bytes',()=>{
  const v=data();assert.throws(()=>verify({receiptBytes:bytes('{'),
    baseTapBytes:v.baseTapBytes,correlationTapBytes:v.correlationTapBytes,artifactTapBytes:v.artifactTapBytes,expected:v.expected}),/E_RECEIPT_JSON/);
});
test('reject oversized receipt bytes',()=>{
  const v=data();assert.throws(()=>verify({receiptBytes:Buffer.alloc(65537),
    baseTapBytes:v.baseTapBytes,correlationTapBytes:v.correlationTapBytes,artifactTapBytes:v.artifactTapBytes,expected:v.expected}),/E_BYTES/);
});
test('reject invalid UTF-8 in receipt bytes',()=>{
  const v=data();assert.throws(()=>verify({receiptBytes:Buffer.from([0xff,0xfe,0xff]),
    baseTapBytes:v.baseTapBytes,correlationTapBytes:v.correlationTapBytes,artifactTapBytes:v.artifactTapBytes,expected:v.expected}),/E_RECEIPT_JSON/);
});
