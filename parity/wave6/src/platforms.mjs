/** Narrow host-side target receipts. No OS signing authority or device attestation is assumed. */
import { createHash } from 'node:crypto';

const err = msg=>{throw Error('platform: '+msg)};
const need=(p,s)=>{if(!p)err(s)};
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const git=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const safe=x=>typeof x==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const keys=(o,required)=>{
 need(o&&typeof o==='object'&&!Array.isArray(o),'unknown/missing platform fields');
 const proto=Object.getPrototypeOf(o),symbols=Object.getOwnPropertySymbols(o);
 const descriptors=Object.getOwnPropertyDescriptors(o),names=Object.keys(descriptors);
 need((proto===Object.prototype||proto===null)&&symbols.length===0&&
  names.length===required.length&&required.every(k=>Object.hasOwn(descriptors,k))&&
  names.every(k=>Object.hasOwn(descriptors[k],'value')&&descriptors[k].enumerable===true),
  'platform fields must be plain enumerable data without accessors/symbols');
};
const LLVM_SOURCE_REPO='ores-truffle-oreslang/oreslang-source.llvm';
export const PROFILES=Object.freeze({
 'android-arm64':Object.freeze({task:26,os:'android',cpu:'arm64-v8a',binding:'JNI',aot:'native-library',platformRepo:'ores-truffle-oreslang/oreslang-platform.mobile'}),
 'ios-arm64':Object.freeze({task:26,os:'ios',cpu:'arm64',binding:'Swift-C',aot:'static-only',platformRepo:'ores-truffle-oreslang/oreslang-platform.mobile'}),
 'cortex-m3':Object.freeze({task:27,os:'zephyr',cpu:'thumbv7m',binding:'static-actor',aot:'freestanding',platformRepo:'ores-truffle-oreslang/oreslang-platform.embedded'}),
 'riscv32':Object.freeze({task:27,os:'rtos',cpu:'rv32',binding:'static-actor',aot:'freestanding',platformRepo:'ores-truffle-oreslang/oreslang-platform.embedded'}),
 'mqtt-gateway':Object.freeze({task:28,os:'edge',cpu:'arm64',binding:'MQTT5-mTLS',aot:'native',platformRepo:'ores-truffle-oreslang/oreslang-platform.iot'}),
 'coap-gateway':Object.freeze({task:28,os:'edge',cpu:'arm64',binding:'CoAP-DTLS',aot:'native',platformRepo:'ores-truffle-oreslang/oreslang-platform.iot'}),
 'windows-x64':Object.freeze({task:29,os:'windows',cpu:'x64',binding:'Win32',aot:'native',platformRepo:'ores-truffle-oreslang/oreslang-platform.desktop'}),
 'macos-arm64':Object.freeze({task:29,os:'macos',cpu:'arm64',binding:'Cocoa',aot:'native',platformRepo:'ores-truffle-oreslang/oreslang-platform.desktop'}),
 'linux-x64':Object.freeze({task:29,os:'linux',cpu:'x64',binding:'POSIX',aot:'native',platformRepo:'ores-truffle-oreslang/oreslang-platform.desktop'})
});
const mandatory=['profile','platformRepo','platformSha','sourceRepo','sourceSha','compilerSha256','artifactSha256','artifactBytes','runner','runUrl','executedSteps','platformTests','signing','measurements'];
export function validateCandidate(r){
 keys(r,mandatory);
 need(Object.hasOwn(PROFILES,r.profile),'unrecognized target');
 const profile=PROFILES[r.profile];
 need(r.platformRepo===profile.platformRepo&&git(r.platformSha),'platform repo/tree identity does not match profile');
 need(r.sourceRepo===LLVM_SOURCE_REPO&&git(r.sourceSha)&&sha(r.compilerSha256)&&sha(r.artifactSha256)&&integer(r.artifactBytes)&&r.artifactBytes>0&&r.artifactBytes<=128*1024*1024,'invalid exact-source or binary identity');
 const runPrefix='https://github.com/'+r.platformRepo+'/actions/runs/';
 need(safe(r.runner)&&typeof r.runUrl==='string'&&r.runUrl.startsWith(runPrefix)&&/^[1-9]\d*$/.test(r.runUrl.slice(runPrefix.length)),'runner identity or platform run URL');
 need(Array.isArray(r.executedSteps)&&r.executedSteps.length>0&&r.executedSteps.length<=64&&new Set(r.executedSteps).size===r.executedSteps.length&&r.executedSteps.every(safe),'actual step list missing/invalid');
 need(r.executedSteps.includes('compile-ores-source')&&r.executedSteps.includes('execute-guest'),'missing compiler/guest stage');
 const testKeys=['guestOutput','lifecycle','ownership','cancellation','startup'];keys(r.platformTests,testKeys);
 for(const k of testKeys)need(r.platformTests[k]===true,'missing required device/runtime test '+k);
 keys(r.signing,['format','identity','verifiedByPlatform']);
 need(safe(r.signing.format)&&safe(r.signing.identity)&&r.signing.verifiedByPlatform===true,'unsigned/unknown package receipt');
 keys(r.measurements,['ramBytes','flashBytes','stackBytes','worstCaseUs']);
 for(const k of Object.keys(r.measurements))need(integer(r.measurements[k])&&r.measurements[k]>0,'unbounded performance/memory metric');
 if(r.profile==='ios-arm64')need(r.signing.format==='apple-codesign-static'&&r.platformTests.lifecycle&&r.executedSteps.includes('device-ios')&&!r.executedSteps.includes('jit-fallback'),'iOS static AOT/device policy');
 if(r.profile==='android-arm64')need(r.signing.format==='android-apk'&&r.executedSteps.includes('device-android'),'Android ABI/device test');
 if(r.profile==='cortex-m3'||r.profile==='riscv32'){
  need(r.measurements.ramBytes<=65536&&r.measurements.stackBytes<=8192&&r.measurements.flashBytes<=262144,'embedded admission budget exceeded/missing WCET');
  need(r.executedSteps.includes('source-actor-messages')&&r.executedSteps.includes('supervision-fault-test'),'embedded actor/RTOS gate');
 }
 if(r.profile.endsWith('-gateway'))need(r.executedSteps.includes('mutual-authentication')&&r.executedSteps.includes('replay-fault-injection')&&r.executedSteps.includes('signed-ota-powerloss'),'IoT security tests missing');
 if(r.profile==='windows-x64')need(r.signing.format==='authenticode'&&r.executedSteps.includes('installed-app-launch'),'Windows distribution gate');
 if(r.profile==='macos-arm64')need(r.signing.format==='apple-notarized'&&r.executedSteps.includes('installed-app-launch'),'macOS distribution gate');
 if(r.profile==='linux-x64')need(r.signing.format==='linux-verified-package'&&r.executedSteps.includes('installed-app-launch'),'Linux distribution gate');
 // Self-declared receipts can be evaluated but do not attest their signer's authority.
 return Object.freeze({profile:r.profile,platformRepo:r.platformRepo,platformSha:r.platformSha,requiredFieldsPass:true,realDeviceVerified:false,compilerProvenanceVerified:false,distributionCertified:false,warning:'Receipt contents and signing authority are not independently verified.'});
}
export function checkArtifactHash(bytes,expectedSha256){
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=128*1024*1024,'bounded nonempty artifact required');
 need(sha(expectedSha256),'invalid digest');
 need(createHash('sha256').update(bytes).digest('hex')===expectedSha256,'artifact bytes do not match pinned digest');
 return Object.freeze({hashMatched:true,compilerProvenanceVerified:false});
}
