import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {load,validate} from '../src/manifest.mjs';
import {PROFILES,validateCandidate,checkArtifactHash} from '../src/platforms.mjs';
import {OtaStagingGate,validateOtaManifest,canonicalOta,canonicalBoot} from '../src/ota.mjs';
import {BACKENDS,CASES,validateObservation,semanticProjection,compareEvidence,verifySignedObservation} from '../src/differential.mjs';

const H=x=>createHash('sha256').update(x).digest('hex');
const dummy='a'.repeat(64),sourceSha='b'.repeat(64),git='c'.repeat(40);
const kp=()=>generateKeyPairSync('ed25519');
function otaSetup(){
 const release=kp(),boot=kp(),deviceId='device-8',target='cortex-m3',image=Buffer.from('new firmware bytes');
 const gate=new OtaStagingGate({deviceId,target,activeVersion:1,bootCounter:5,activeSha256:H(Buffer.from('old')),
  releaseKeys:{release1:release.publicKey},deviceBootPublicKey:boot.publicKey});
 const manifest={schema:1,deviceId,target,version:2,previousVersion:1,sha256:H(image),bytes:image.length,nonce:'signed-random-nonce-0001',expiresAtMs:2_000_000_000_000,keyId:'release1'};
 const releaseSig=sign(null,canonicalOta(manifest),release.privateKey);
 const bootReceipt={schema:1,deviceId,target,version:2,sha256:H(image),nonce:manifest.nonce,bootCounter:6};
 const bootSig=sign(null,canonicalBoot(bootReceipt),boot.privateKey);
 return {gate,manifest,image,releaseSig,bootReceipt,bootSig,release,boot};
}
function receipt(profile){
 const signing={format:profile==='ios-arm64'?'apple-codesign-static':profile==='android-arm64'?'android-apk':profile==='windows-x64'?'authenticode':profile==='macos-arm64'?'apple-notarized':profile==='linux-x64'?'linux-verified-package':'signed-firmware',identity:'issuer-1',verifiedByPlatform:true};
 const executedSteps=['compile-ores-source','execute-guest'];
 if(profile==='ios-arm64')executedSteps.push('device-ios');
 if(profile==='android-arm64')executedSteps.push('device-android');
 if(['cortex-m3','riscv32'].includes(profile))executedSteps.push('source-actor-messages','supervision-fault-test');
 if(profile.endsWith('-gateway'))executedSteps.push('mutual-authentication','replay-fault-injection','signed-ota-powerloss');
 if(['windows-x64','macos-arm64','linux-x64'].includes(profile))executedSteps.push('installed-app-launch');
 const platformRepo=PROFILES[profile].platformRepo;
 return {profile,platformRepo,platformSha:git,sourceRepo:'ores-truffle-oreslang/oreslang-source.llvm',sourceSha:git,compilerSha256:dummy,artifactSha256:sourceSha,artifactBytes:8192,
  runner:'gh-runner',runUrl:'https://github.com/'+platformRepo+'/actions/runs/1234567',executedSteps,
  platformTests:{guestOutput:true,lifecycle:true,ownership:true,cancellation:true,startup:true},signing,measurements:{ramBytes:4096,flashBytes:8192,stackBytes:1024,worstCaseUs:50}};
}
function observation(backend='java',caseId='checked-i64-42',value='42'){
 return {backend,caseId,sourceSha256:sourceSha,sourceGitSha:git,compilerSha256:dummy,artifactSha256:'d'.repeat(64),runId:'1234567',steps:['build-source','run-guest'],outcome:'pass',diagnostic:'',value,
 actorTrace:[{id:'1',parent:null,kind:'spawn',data:'root'},{id:'2',parent:'1',kind:'send',data:'42'}],metrics:{peakBytes:4096,stepsExecuted:100,elapsedUs:10}};
}

test('26–30 / exact three-source fixture hashes and unverified profiles',async()=>{
 const m=await load();assert.deepEqual(m.tasks.map(t=>t.id),[26,27,28,29,30]);assert.equal(m.certifiedParity,false);
 assert.equal(m.fixtures.length,3);assert.equal(m.profiles.length,9);assert.equal(m.backends.length,5);
});
test('26–30 / malformed manifests and false certification cannot be slipped into matrix',async()=>{
 for(const change of [m=>m.certifiedParity=true,m=>m.profiles.pop(),m=>m.backends.splice(2,1),m=>m.fixtures[0].status='VERIFIED',m=>m.fixtures[0].gitBlob='0'.repeat(40),m=>m.tasks[0].verified=true,m=>m.tasks[4].id=27]){
  const m=structuredClone(await load());change(m);assert.throws(()=>validate(m),/wave6-manifest/);
 }
});
test('26–30 / CLI validates only pinned source, never claims execution',()=>{
 const p=new URL('../bin/check.mjs',import.meta.url).pathname;
 const ok=spawnSync(process.execPath,[p],{encoding:'utf8'});assert.equal(ok.status,0,ok.stderr);
 const result=JSON.parse(ok.stdout);assert.equal(result.status,'PINNED_CONTRACT_ONLY');assert.equal(result.releaseCertified,false);assert.equal(result.realCompilerExecuted,false);
 assert.equal(spawnSync(process.execPath,[p,'--claim-parity'],{encoding:'utf8'}).status,2);
});
test('26 / Android and iOS targets require actual device-run and static iOS profile evidence fields',()=>{
 for(const p of ['android-arm64','ios-arm64']){const r=validateCandidate(receipt(p));assert.equal(r.realDeviceVerified,false);assert.equal(r.distributionCertified,false)}
 const android=receipt('android-arm64');android.executedSteps=android.executedSteps.filter(x=>x!=='device-android');assert.throws(()=>validateCandidate(android),/Android/);
 const ios=receipt('ios-arm64');ios.executedSteps.push('jit-fallback');assert.throws(()=>validateCandidate(ios),/iOS/);
});
test('26 / mobile receipt must have JNI/Swift source compilation and lifecycle measurements, no runner-less claims',()=>{
 const r=receipt('ios-arm64');r.executedSteps=['compile-ores-source'];assert.throws(()=>validateCandidate(r),/compiler\/guest/);
 const q=receipt('android-arm64');q.platformTests.cancellation=false;assert.throws(()=>validateCandidate(q),/cancellation/);
});
test('27 / embedded Cortex-M and RV32 budgets do not waive actor supervision and WCET tests',()=>{
 for(const p of ['cortex-m3','riscv32'])assert.equal(validateCandidate(receipt(p)).distributionCertified,false);
 const bad=receipt('riscv32');bad.measurements.stackBytes=999999;assert.throws(()=>validateCandidate(bad),/embedded/);
 const missing=receipt('cortex-m3');missing.executedSteps=missing.executedSteps.filter(x=>x!=='source-actor-messages');assert.throws(()=>validateCandidate(missing),/actor/);
});
test('28 / MQTT and CoAP claim requires secure transport, replay and power-loss evidence',()=>{
 for(const p of ['mqtt-gateway','coap-gateway'])assert.equal(validateCandidate(receipt(p)).realDeviceVerified,false);
 const bad=receipt('mqtt-gateway');bad.executedSteps=bad.executedSteps.filter(x=>x!=='mutual-authentication');assert.throws(()=>validateCandidate(bad),/IoT/);
});
test('29 / OS-native desktop signing and installed app execution are mandatory',()=>{
 for(const p of ['windows-x64','macos-arm64','linux-x64'])assert.equal(validateCandidate(receipt(p)).distributionCertified,false);
 const bad=receipt('windows-x64');bad.signing.format='unsigned';assert.throws(()=>validateCandidate(bad),/Windows/);
 const mac=receipt('macos-arm64');mac.executedSteps=mac.executedSteps.filter(x=>x!=='installed-app-launch');assert.throws(()=>validateCandidate(mac),/macOS/);
});
test('26–29 / platform receipts reject accessors, symbols and non-plain nested evidence before reading values',()=>{
 const getter=receipt('android-arm64');
 Object.defineProperty(getter,'platformRepo',{enumerable:true,get(){throw Error('GETTER EXECUTED')}});
 assert.throws(()=>validateCandidate(getter),/plain enumerable data/);
 const symbol=receipt('ios-arm64');symbol[Symbol('hidden')]='surprise';
 assert.throws(()=>validateCandidate(symbol),/plain enumerable data/);
 const nested=receipt('linux-x64');
 Object.defineProperty(nested.signing,'identity',{enumerable:true,get(){throw Error('NESTED GETTER EXECUTED')}});
 assert.throws(()=>validateCandidate(nested),/plain enumerable data/);
});
test('26–29 / platform evidence is bound to the exact expected platform repo and run',()=>{
 const wrongRepo=receipt('android-arm64');wrongRepo.platformRepo='ores-truffle-oreslang/oreslang-platform.iot';assert.throws(()=>validateCandidate(wrongRepo),/platform repo/);
 const wrongRun=receipt('linux-x64');wrongRun.runUrl='https://github.com/ores-truffle-oreslang/oreslang-platform.mobile/actions/runs/123';assert.throws(()=>validateCandidate(wrongRun),/platform run URL/);
 const wrongSource=receipt('cortex-m3');wrongSource.sourceRepo='ores-truffle-oreslang/oreslang-source.java';assert.throws(()=>validateCandidate(wrongSource),/binary identity/);
});
test('26–29 / resource and artifact measurements are positive and bounded',()=>{
 const zero=receipt('macos-arm64');zero.measurements.stackBytes=0;assert.throws(()=>validateCandidate(zero),/performance\/memory/);
 const huge=receipt('android-arm64');huge.artifactBytes=128*1024*1024+1;assert.throws(()=>validateCandidate(huge),/binary identity/);
});
test('26–29 / candidate receipts remain non-certified even when all caller-claimed conditions are true',()=>{
 for(const p of Object.keys(PROFILES)){const res=validateCandidate(receipt(p));assert.equal(res.compilerProvenanceVerified,false);assert.equal(res.distributionCertified,false)}
});
test('26–29 / pinned artifact byte hash cannot be substituted by metadata',()=>{
 const bytes=Buffer.from('native bytes');assert.equal(checkArtifactHash(bytes,H(bytes)).hashMatched,true);
 assert.throws(()=>checkArtifactHash(bytes,H(Buffer.from('different'))),/digest/);
});
test('28 / canonical Ed25519 OTA signed release verifies and stages without active firmware switch',()=>{
 const x=otaSetup();const result=x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000});
 assert.equal(result.status,'STAGED_UNCOMMITTED');assert.equal(x.gate.state.version,1);assert.equal(x.gate.state.stagedVersion,2);
});
test('28 / boot receipt must be separately signed by device before commit',()=>{
 const x=otaSetup();x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000});
 assert.throws(()=>x.gate.commit(x.bootReceipt,x.releaseSig),/boot proof signature/);
 const ok=x.gate.commit(x.bootReceipt,x.bootSig);assert.equal(ok.status,'COMMITTED_AFTER_SIGNED_BOOT_RECEIPT');assert.equal(x.gate.state.version,2);assert.equal(ok.realDeviceBootProven,false);
});
test('28 / tampered payload, forged signature, expiration and wrong device target fail closed',()=>{
 for(const edit of [x=>x.image[0]^=7,x=>x.releaseSig=Buffer.alloc(64),x=>x.manifest.deviceId='another',x=>x.manifest.target='rv32imac',x=>x.manifest.expiresAtMs=1]){
  const x=otaSetup();edit(x);assert.throws(()=>x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000}),/ota:/);assert.equal(x.gate.state.version,1);
 }
});
test('28 / rollback attempts, replayed release nonce, stale boot counter cannot be admitted',()=>{
 const x=otaSetup();x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000});x.gate.abort();
 assert.throws(()=>x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000}),/replayed/);
 const y=otaSetup();y.gate.stage(y.manifest,y.image,y.releaseSig,{nowMs:1_800_000_000_000});
 const receipt={...y.bootReceipt,bootCounter:5};const signature=sign(null,canonicalBoot(receipt),y.boot.privateKey);
 assert.throws(()=>y.gate.commit(receipt,signature),/boot receipt/);
});
test('28 / signed manifest has strict field allowlist; getters and symbol fields never execute',()=>{
 const x=otaSetup(),m={...x.manifest,extra:'privilege'};assert.throws(()=>validateOtaManifest(m),/schema/);
 const trap={...x.manifest};Object.defineProperty(trap,'keyId',{get(){throw Error('GETTER EXECUTED')},enumerable:true});
 assert.throws(()=>validateOtaManifest(trap),/accessor\/symbol/);
});
test('28 / power-loss before signed boot confirmation cannot promote staged firmware',()=>{
 const x=otaSetup();x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000});
 const prior=x.gate.state;assert.equal(prior.version,1);assert.equal(x.gate.abort(),true);
 assert.equal(x.gate.state.version,1);assert.equal(x.gate.state.stagedVersion,null);
});
test('28 / invalid counter and model does not pretend storage durability',()=>{
 const x=otaSetup();const r=x.gate.stage(x.manifest,x.image,x.releaseSig,{nowMs:1_800_000_000_000});assert.equal(r.persistentRecoveryProven,false);
});
test('30 / all five backend signed-decimal scalar results normalize as observed match not certified parity',()=>{
 const r=compareEvidence(BACKENDS.map(b=>observation(b)),{requiredCases:['checked-i64-42']});
 assert.equal(r.status,'OBSERVED_MATCH_NOT_CERTIFIED');assert.equal(r.certifiedParity,false);assert.equal(r.sourceAndRunnerProvenanceIndependentlyVerified,false);
});
test('30 / a missing backend is always INCOMPLETE, not an implicitly passing compiler',()=>{
 const r=compareEvidence(BACKENDS.slice(0,4).map(b=>observation(b)),{requiredCases:['checked-i64-42']});assert.equal(r.status,'INCOMPLETE');assert.deepEqual(r.missing,[{caseId:'checked-i64-42',backend:'wasm'}]);
});
test('30 / exact guest values, source hashes and traces detect cross-backend divergence',()=>{
 const variants=[x=>x.value='43',x=>x.sourceSha256='e'.repeat(64),x=>x.actorTrace[1].data='unexpected'];
 for(const edit of variants){const list=BACKENDS.map(b=>observation(b));edit(list[3]);const r=compareEvidence(list,{requiredCases:['checked-i64-42']});assert.equal(r.status,'DIVERGENT');assert.ok(r.mismatches.length>0)}
});
test('30 / reject-all cannot masquerade as positive cross-backend agreement',()=>{
 const list=BACKENDS.map(b=>{const o=observation(b);o.outcome='reject';o.value='';o.diagnostic='error: unknown syntax';return o});
 const r=compareEvidence(list,{requiredCases:['checked-i64-42']});assert.equal(r.status,'DIVERGENT');assert.ok(r.mismatches.some(x=>/reject-all/.test(x.reason)));
});
test('30 / duplicate backend, missing executed steps and unsigned arbitrary reports fail closed',()=>{
 const list=BACKENDS.map(b=>observation(b));assert.throws(()=>compareEvidence([...list,list[0]],{requiredCases:['checked-i64-42']}),/duplicate/);
 const o=observation();o.steps=[];assert.throws(()=>validateObservation(o),/steps/);
});
test('30 / actor trace compares causal IDs independent of scheduling timestamp but rejects invalid parent order',()=>{
 const a=observation(),b=observation();assert.equal(semanticProjection(a),semanticProjection(b));
 const c=observation();c.actorTrace[1].parent='missing';assert.throws(()=>validateObservation(c),/causal/);
});
test('30 / cryptographically signed evidence is only a caller-key-valid observation, not trusted CI proof',()=>{
 const k=kp(),obj=observation(),payload=Buffer.from(JSON.stringify(obj),'utf8'),signature=sign(null,payload,k.privateKey);
 const result=verifySignedObservation({payload,signature,publicKey:k.publicKey});assert.equal(result.certifiedParity,false);assert.equal(result.trustRootIndependentlyApproved,false);
 assert.throws(()=>verifySignedObservation({payload,signature:Buffer.alloc(64),publicKey:k.publicKey}),/verify/);
});
test('30 / forged/reordered JSON evidence cannot pass canonical signed observation',()=>{
 const k=kp(),obj=observation();
 const altered=Buffer.from(JSON.stringify({...obj,unknown:42}),'utf8');const sig=sign(null,altered,k.privateKey);
 assert.throws(()=>verifySignedObservation({payload:altered,signature:sig,publicKey:k.publicKey}),/schema/);
});
test('30 / standalone CLI refuses empty/untrusted parity input and unknown arguments',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const p=new URL('../bin/differential.mjs',import.meta.url).pathname;
 const dir=await mkdtemp(join(tmpdir(),'ores-wave6-diff-'));
 try{
  const empty=join(dir,'empty.json');await writeFile(empty,JSON.stringify({records:[],requiredCases:['checked-i64-42']}));
  const r=spawnSync(process.execPath,[p,'--observations='+empty],{encoding:'utf8'});
  assert.equal(r.status,3,r.stderr);assert.equal(JSON.parse(r.stdout).status,'INCOMPLETE');
  assert.equal(spawnSync(process.execPath,[p,'--unknown=yes'],{encoding:'utf8'}).status,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('30 / even an apparently full five-backend report cannot issue certified success',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'ores-wave6-report-'));
 try{
  const file=join(dir,'observations.json');await writeFile(file,JSON.stringify({records:BACKENDS.map(b=>observation(b)),requiredCases:['checked-i64-42']}));
  const r=spawnSync(process.execPath,[new URL('../bin/differential.mjs',import.meta.url).pathname,'--observations='+file],{encoding:'utf8'});
  assert.equal(r.status,4,r.stderr);const observationReport=JSON.parse(r.stdout);
  assert.equal(observationReport.status,'OBSERVED_MATCH_NOT_CERTIFIED');assert.equal(observationReport.certifiedParity,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
