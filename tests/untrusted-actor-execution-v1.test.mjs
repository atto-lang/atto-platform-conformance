import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessUntrustedExecution} from '../src/untrusted-actor-execution-v1.mjs';
const contract=JSON.parse(readFileSync(new URL('../contracts/untrusted-actor-execution-v1.json',import.meta.url),'utf8'));
const sha='a'.repeat(64);
const quotas={guestMemoryBytes:65536,hostMemoryBytes:131072,actorCount:2,mailboxBytes:4096,wallTimeMs:1000};
const request={backend:'net',trust:'untrusted',mode:'jit',guestFormat:'wasm',imageSha256:sha,
  capabilities:[],quotas};
const host={backend:'net',hostKind:'native-aot',supportedModes:['jit','aot','interpreted'],
  supportedFormats:['wasm','cil'],verifiedImageSha256:sha,trustedSupervisor:true,
  osProcessSandbox:true,isolatedWorker:true,workerTermination:true,preemption:'fuel',
  guestHeapQuota:true,hostHeapQuota:true,mailboxQuota:true,capabilityBroker:true,
  allowedCapabilities:['network:read'],limits:{guestMemoryBytes:1024*1024,hostMemoryBytes:1024*1024,
    actorCount:10,mailboxBytes:65536,wallTimeMs:10000},jitWxEnforced:true,
  boundedJitCompilation:true,wasmJitEngine:true};
const clone=x=>structuredClone(x);
const deny=(name,mutate,pattern)=>test(name,()=>{
  const r=clone(request),h=clone(host);mutate(r,h);
  assert.throws(()=>assessUntrustedExecution(r,h),new RegExp(pattern));
});
test('contract makes trust, mode, format and isolation independent; evidence is not executed',()=>{
  assert.equal(contract.schema,'attolang.untrusted-actor-execution.v1');
  assert.equal(contract.policy.untrustedAotRequired,false);
  assert.equal(contract.policy.untrustedJitPermitted,true);
  assert.deepEqual(contract.compilationModes,['aot','jit','interpreted']);
  assert.deepEqual(Object.keys(contract.backendTargets).sort(),['forge','java','llvm','net','wasm']);
  for(const item of Object.values(contract.backendTargets))assert.equal(item.status,'NOT_EXECUTED');
});
test('native-aot host can model an independently sandboxed Wasm JIT (not runtime proof)',()=>{
  assert.deepEqual(assessUntrustedExecution(request,host),{
    status:'SOURCE_FREE_MODEL_ADMISSIBLE',admissibleInModel:true,productionCertified:false,
    backend:'net',mode:'jit',trust:'untrusted'});
});
test('AOT and interpreted remain independent from untrusted trust selection',()=>{
  for(const mode of ['aot','interpreted']){
    const r={...request,mode};
    assert.equal(assessUntrustedExecution(r,host).productionCertified,false);
  }
});
test('managed CLR JIT inside verified process worker can be modeled, never certified',()=>{
  const r={...request,mode:'jit',guestFormat:'cil'};
  const h={...host,hostKind:'managed-jit',preemption:'worker-termination'};
  assert.equal(assessUntrustedExecution(r,h).status,'SOURCE_FREE_MODEL_ADMISSIBLE');
});
deny('no silent trust downgrade',r=>r.trust='trusted','NOT_UNTRUSTED_PROFILE');
deny('unknown backend fails closed',r=>r.backend='magic','UNKNOWN_BACKEND');
deny('unknown mode fails closed',r=>r.mode='auto','UNKNOWN_COMPILATION_MODE');
deny('forged extra request field fails closed',r=>r.ignoreSecurity=true,'INVALID_REQUEST_FIELDS');
deny('forged extra supervisor field fails closed',(r,h)=>h.skipCheck=true,'INVALID_HOST_FIELDS');
deny('arbitrary guest digest refused',r=>r.imageSha256='bad','INVALID_IMAGE_SHA256');
deny('unverified guest image refused',(r,h)=>h.verifiedImageSha256='b'.repeat(64),'UNVERIFIED_IMAGE');
deny('untrusted supervisor descriptor refused',(r,h)=>h.trustedSupervisor=false,'AUTHENTICATED_SUPERVISOR_REQUIRED');
deny('tenant cannot use only a wasm store',(r,h)=>h.osProcessSandbox=false,'OS_SANDBOX_REQUIRED');
deny('tenant cannot use in-process worker only',(r,h)=>h.isolatedWorker=false,'OS_SANDBOX_REQUIRED');
deny('process must remain killable',(r,h)=>h.workerTermination=false,'WORKER_TERMINATION_REQUIRED');
deny('execution preemption mechanism mandatory',(r,h)=>h.preemption='none','PREEMPTION_REQUIRED');
deny('guest memory enforcement mandatory',(r,h)=>h.guestHeapQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('host memory accounting mandatory',(r,h)=>h.hostHeapQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('mailbox quota enforcement mandatory',(r,h)=>h.mailboxQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('capabilities must be brokered',(r,h)=>h.capabilityBroker=false,'CAPABILITY_BROKER_REQUIRED');
deny('ambient host capability refused',r=>r.capabilities=['ffi'],'CAPABILITY_DENIED');
deny('requested memory cannot exceed admitted limit',r=>r.quotas.guestMemoryBytes=2**40,'RESOURCE_QUOTA_EXCEEDED');
deny('zero quota refused',r=>r.quotas.actorCount=0,'INVALID_REQUEST_QUOTAS_actorCount');
deny('unsafe integer refused',r=>r.quotas.wallTimeMs=Number.MAX_SAFE_INTEGER+1,'INVALID_REQUEST_QUOTAS_wallTimeMs');
deny('NativeAOT cannot directly JIT CIL',r=>r.guestFormat='cil','NATIVEAOT_CIL_JIT_UNAVAILABLE');
deny('JIT requires executable-memory policy',(r,h)=>h.jitWxEnforced=false,'JIT_GOVERNANCE_REQUIRED');
deny('JIT compiler work must be bounded',(r,h)=>h.boundedJitCompilation=false,'JIT_GOVERNANCE_REQUIRED');
deny('NativeAOT does not provide a Wasm JIT automatically',(r,h)=>h.wasmJitEngine=false,'WASM_JIT_ENGINE_REQUIRED');
deny('unsupported requested format refused',r=>r.guestFormat='native','UNSUPPORTED_GUEST_FORMAT');
deny('no duplicate capability entries',r=>r.capabilities=['network:read','network:read'],'INVALID_REQUEST_CAPABILITIES');
deny('unexpected limit key refused',(r,h)=>h.limits.extra=1,'INVALID_HOST_LIMITS_FIELDS');
deny('managed CIL requires a killable process rather than just Wasm fuel',(r,h)=>{r.guestFormat='cil';h.hostKind='managed-jit';},'NATIVE_GUEST_INTERRUPTION_REQUIRED');
