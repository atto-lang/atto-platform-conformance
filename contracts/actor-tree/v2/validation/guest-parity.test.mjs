import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compareCaptures, verifyCapture, gitBlobSha1, parseCanonicalAudit, loadManifest, main, guestRunnerEnvironment} from './guest-parity.mjs';

const manifest=JSON.parse(readFileSync(resolve(import.meta.dirname,'../guest/manifest.json'),'utf8'));
const route=[
  {runtimeId:'runtime-llvm',actorId:'stage/A',incarnation:1},
  {runtimeId:'runtime-llvm',actorId:'stage/B',incarnation:1},
  {runtimeId:'runtime-llvm',actorId:'stage/C',incarnation:1}
];
const values=manifest.expectedValues;
function authority(runtimeId='runtime-llvm') {
  return {expectedPipelineId:'trusted-pipeline-1', expectedSchemaHash:manifest.schemaHash,
    expectedRoute:route.map(x=>({...x,runtimeId}))};
}
function audit(backend='llvm-native', runtimeId='runtime-llvm') {
  const actors=route.map(x=>({...x,runtimeId}));
  const steps=[[0,1,'forward'],[1,2,'forward'],[2,1,'backward'],[1,0,'backward']];
  return {kind:'oreslang-v2-guest-audit', backend, sourceGitBlobSha1:manifest.sourceGitBlobSha1,
    trace:{schemaVersion:'2.0.0',pipelineId:'trusted-pipeline-1',route:actors,
      messages:steps.map(([from,to,direction],i)=>({
        messageId:'msg-'+i,hopIndex:i,direction,
        from:{...actors[from]},to:{...actors[to]},schemaHash:manifest.schemaHash,
        payload:{variant:'Number',i64Decimal:values[i]}
      }))},
    physicalDone:actors.map(actor=>({actor:{...actor},done:true,cleanupDrained:true}))};
}
test('candidate guest fixture Git blob matches pinned SHA',()=>{
  const source=readFileSync(resolve(import.meta.dirname,'../guest/three-actor-signed-i64.ores'));
  assert.equal(gitBlobSha1(source),manifest.sourceGitBlobSha1);
});
test('synthetic positive verifier self-test normalizes different runtime IDs',()=>{
  const result=compareCaptures(audit(),audit('java-graalvm','runtime-java'),
      manifest,authority(),authority('runtime-java'));
  assert.equal(result.status,'verified');
  assert.deepEqual(result.values,values);
});
for(const [name,mutate] of [
  ['missing physical DONE',e=>e.physicalDone.pop()],
  ['duplicated DONE',e=>e.physicalDone[1]=structuredClone(e.physicalDone[0])],
  ['incomplete cleanup',e=>e.physicalDone[2].cleanupDrained=false],
  ['unknown evidence property',e=>e.isApproved=true],
  ['source mismatch',e=>e.sourceGitBlobSha1='0'.repeat(40)],
  ['replayed delivery',e=>e.trace.messages[3].messageId=e.trace.messages[0].messageId],
  ['wrong direction',e=>e.trace.messages[2].direction='forward'],
  ['forged actor incarnation',e=>e.trace.messages[3].to.incarnation=2],
  ['wrong signed-64 result',e=>e.trace.messages[3].payload.i64Decimal='1'],
  ['schema substitution',e=>e.trace.messages[0].schemaHash='f'.repeat(64)],
]) {
  test('gate rejects '+name,()=>{
    const a=audit();mutate(a);
    assert.throws(()=>verifyCapture(a,'llvm-native',manifest,authority()));
  });
}
test('gate refuses backend swap and authority derived from a foreign route',()=>{
  assert.throws(()=>verifyCapture(audit('java-graalvm'),'llvm-native',manifest,authority()));
  assert.throws(()=>verifyCapture(audit(),'llvm-native',manifest,authority('other')));
});
test('both runtimes required; one valid trace cannot certify parity',()=>{
  assert.throws(()=>compareCaptures(audit(),undefined,manifest,authority(),authority('runtime-java')));
});

test('manifest rejects SHA or source drift before executing any runner',()=>{
  const loaded=loadManifest();
  assert.equal(loaded.manifest.sourceGitBlobSha1,manifest.sourceGitBlobSha1);
});
test('audit FD requires single compact canonical JSON record',()=>{
  const value=audit();
  const canonical=JSON.stringify(value)+'\n';
  assert.deepEqual(parseCanonicalAudit(Buffer.from(canonical)),value);
  assert.throws(()=>parseCanonicalAudit(Buffer.from(canonical+'\n')));
  assert.throws(()=>parseCanonicalAudit(Buffer.from(canonical+canonical)));
  assert.throws(()=>parseCanonicalAudit(Buffer.from('{"kind":"a","kind":"b"}\n')));
  assert.throws(()=>parseCanonicalAudit(Buffer.from('{"kind": "a"}\n')));
});
test('the CLI refuses to certify without both real runner paths and trusted host files',()=>{
  assert.throws(()=>main([]),/both backend runners/);
});

test('guest runner env never inherits CI secrets or forged source flags',()=>{
  const host={
    PATH:'/usr/bin:/bin', LANG:'C.UTF-8', JAVA_HOME:'/opt/jdk',
    GITHUB_TOKEN:'private', AWS_ACCESS_KEY_ID:'private',
    AWS_SECRET_ACCESS_KEY:'private', SSH_AUTH_SOCK:'/tmp/agent',
    HOME:'/home/ci-with-secrets',
    ORESLANG_GUEST_SOURCE:'/tmp/malicious.ores',
    ORESLANG_GUEST_BACKEND:'forged',
  };
  const env=guestRunnerEnvironment(host,'llvm-native',manifest,
    '/trusted/source/three-actor-signed-i64.ores');
  assert.equal(env.PATH,host.PATH);
  assert.equal(env.JAVA_HOME,host.JAVA_HOME);
  assert.equal(env.ORESLANG_GUEST_SOURCE,'/trusted/source/three-actor-signed-i64.ores');
  assert.equal(env.ORESLANG_GUEST_BACKEND,'llvm-native');
  assert.equal(env.ORESLANG_GUEST_SOURCE_GIT_BLOB,manifest.sourceGitBlobSha1);
  for(const secret of ['GITHUB_TOKEN','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY',
      'SSH_AUTH_SOCK','HOME']) {
    assert.equal(Object.hasOwn(env,secret),false,
      secret+' must never be forwarded to the compiled guest runner');
  }
});
test('reject unknown guest backend and malformed source identity before launch',()=>{
  assert.throws(()=>guestRunnerEnvironment({PATH:'/usr/bin'},'unknown',
    manifest,'/real/source.ores'), /invalid guest runner environment authority/);
  assert.throws(()=>guestRunnerEnvironment({},'llvm-native',
    {...manifest,sourceGitBlobSha1:'short'},'/real/source.ores'),
    /invalid guest runner environment authority/);
});
