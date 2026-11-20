import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessUntrustedExecution} from '../src/untrusted-actor-execution-v1.mjs';
const contract=JSON.parse(readFileSync(new URL('../contracts/untrusted-actor-execution-v1.json',import.meta.url),'utf8'));
const sha='a'.repeat(64);
const quotas={guestMemoryBytes:65536,hostMemoryBytes:131072,actorCount:2,mailboxBytes:4096,wallTimeMs:1000};
const request={backend:'net',trust:'untrusted',mode:'jit',guestFormat:'wasm',imageSha256:sha,
  capabilities:[],quotas};
// A NativeAOT .NET host running Wasm tenants in per-tenant isolates inside
// one shared OS process: no process sandbox.
const host={backend:'net',hostKind:'native-aot',supportedModes:['jit','aot','interpreted'],
  supportedFormats:['wasm','cil'],verifiedImageSha256:sha,trustedSupervisor:true,
  perTenantVmIsolate:true,isolateTermination:true,osProcessSandbox:false,preemption:'carrier-interrupt',
  guestHeapQuota:true,hostHeapQuota:true,mailboxQuota:true,capabilityBroker:true,
  allowedCapabilities:['network:read'],limits:{guestMemoryBytes:1024*1024,hostMemoryBytes:1024*1024,
    actorCount:10,mailboxBytes:65536,wallTimeMs:10000},jitWxEnforced:true,
  boundedJitCompilation:true,wasmJitEngine:true};
const graal={...host,backend:'java',hostKind:'graal',supportedFormats:['truffle'],preemption:'bounded-safepoints'};
const truffle={...request,backend:'java',guestFormat:'truffle'};
const clone=x=>structuredClone(x);
const deny=(name,mutate,pattern,base=[request,host])=>test(name,()=>{
  const r=clone(base[0]),h=clone(base[1]);mutate(r,h);
  assert.throws(()=>assessUntrustedExecution(r,h),new RegExp(pattern));
});
test('contract: trust, mode, format and isolation independent; tenants share a process',()=>{
  assert.equal(contract.schema,'attolang.untrusted-actor-execution.v1');
  assert.equal(contract.tenantIsolationContract,'oreslang.tenant-isolation.v2');
  assert.equal(contract.policy.untrustedAotRequired,false);
  assert.equal(contract.policy.untrustedJitPermitted,true);
  assert.equal(contract.policy.hostileTenantsShareProcess,true);
  assert.equal(contract.policy.hostileRequiresPerTenantVmIsolate,true);
  assert.equal(contract.policy.osProcessSandboxRequired,false);
  assert.ok(contract.policy.mandatory.includes('per-tenant-vm-isolate'));
  assert.ok(!contract.policy.mandatory.includes('process-os-sandbox'));
  assert.deepEqual(contract.untrustedGuestFormats,['wasm','truffle']);
  assert.deepEqual(contract.compilationModes,['aot','jit','interpreted']);
  assert.deepEqual(Object.keys(contract.backendTargets).sort(),['forge','java','llvm','net','wasm']);
  for(const item of Object.values(contract.backendTargets))assert.equal(item.status,'NOT_EXECUTED');
});
test('NativeAOT host models Wasm JIT tenants in a shared process (not runtime proof)',()=>{
  assert.deepEqual(assessUntrustedExecution(request,host),{
    status:'SOURCE_FREE_MODEL_ADMISSIBLE',admissibleInModel:true,productionCertified:false,
    backend:'net',mode:'jit',trust:'untrusted'});
});
test('an optional process sandbox is accepted but never required',()=>{
  assert.equal(assessUntrustedExecution(request,{...host,osProcessSandbox:true}).admissibleInModel,true);
  assert.equal(assessUntrustedExecution(request,{...host,osProcessSandbox:false}).admissibleInModel,true);
});
test('AOT and interpreted remain independent from untrusted trust selection',()=>{
  for(const mode of ['aot','interpreted'])
    assert.equal(assessUntrustedExecution({...request,mode},host).productionCertified,false);
});
test('Truffle in a Graal isolate with safepoints is admissible',()=>{
  assert.equal(assessUntrustedExecution(truffle,graal).status,'SOURCE_FREE_MODEL_ADMISSIBLE');
});
deny('no silent trust downgrade',r=>r.trust='trusted','NOT_UNTRUSTED_PROFILE');
deny('unknown backend fails closed',r=>r.backend='magic','UNKNOWN_BACKEND');
deny('unknown mode fails closed',r=>r.mode='auto','UNKNOWN_COMPILATION_MODE');
deny('forged extra request field fails closed',r=>r.ignoreSecurity=true,'INVALID_REQUEST_FIELDS');
deny('forged extra supervisor field fails closed',(r,h)=>h.skipCheck=true,'INVALID_HOST_FIELDS');
deny('removed v1 process-worker fields are refused',(r,h)=>{h.isolatedWorker=true;},'INVALID_HOST_FIELDS');
deny('process-sandbox flag must be a boolean',(r,h)=>h.osProcessSandbox='yes','INVALID_HOST_OS_PROCESS_SANDBOX');
deny('arbitrary guest digest refused',r=>r.imageSha256='bad','INVALID_IMAGE_SHA256');
deny('unverified guest image refused',(r,h)=>h.verifiedImageSha256='b'.repeat(64),'UNVERIFIED_IMAGE');
deny('untrusted supervisor descriptor refused',(r,h)=>h.trustedSupervisor=false,'AUTHENTICATED_SUPERVISOR_REQUIRED');
deny('a per-tenant isolate is mandatory',(r,h)=>h.perTenantVmIsolate=false,'VM_ISOLATE_REQUIRED');
deny('a process sandbox does not replace the isolate',(r,h)=>{h.perTenantVmIsolate=false;h.osProcessSandbox=true;},'VM_ISOLATE_REQUIRED');
deny('one tenant must be killable on its own',(r,h)=>h.isolateTermination=false,'ISOLATE_TERMINATION_REQUIRED');
deny('execution preemption mechanism mandatory',(r,h)=>h.preemption='none','PREEMPTION_REQUIRED');
deny('killing the shared process is not tenant preemption',(r,h)=>h.preemption='worker-termination','PREEMPTION_REQUIRED');
deny('guest memory enforcement mandatory',(r,h)=>h.guestHeapQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('host memory accounting mandatory',(r,h)=>h.hostHeapQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('mailbox quota enforcement mandatory',(r,h)=>h.mailboxQuota=false,'RESOURCE_ENFORCEMENT_REQUIRED');
deny('capabilities must be brokered',(r,h)=>h.capabilityBroker=false,'CAPABILITY_BROKER_REQUIRED');
deny('ambient host capability refused',r=>r.capabilities=['ffi'],'CAPABILITY_DENIED');
deny('requested memory cannot exceed admitted limit',r=>r.quotas.guestMemoryBytes=2**40,'RESOURCE_QUOTA_EXCEEDED');
deny('zero quota refused',r=>r.quotas.actorCount=0,'INVALID_REQUEST_QUOTAS_actorCount');
deny('unsafe integer refused',r=>r.quotas.wallTimeMs=Number.MAX_SAFE_INTEGER+1,'INVALID_REQUEST_QUOTAS_wallTimeMs');
deny('untrusted CIL refused under NativeAOT',r=>r.guestFormat='cil','UNTRUSTED_CIL_REFUSED');
deny('untrusted CIL refused under managed CLR JIT too',(r,h)=>{r.guestFormat='cil';h.hostKind='managed-jit';},'UNTRUSTED_CIL_REFUSED');
deny('tenant-supplied native code refused',(r,h)=>{r.guestFormat='native';h.supportedFormats.push('native');},'UNTRUSTED_NATIVE_CODE_REFUSED');
deny('JIT requires executable-memory policy',(r,h)=>h.jitWxEnforced=false,'JIT_GOVERNANCE_REQUIRED');
deny('JIT compiler work must be bounded',(r,h)=>h.boundedJitCompilation=false,'JIT_GOVERNANCE_REQUIRED');
deny('NativeAOT does not provide a Wasm JIT automatically',(r,h)=>h.wasmJitEngine=false,'WASM_JIT_ENGINE_REQUIRED');
deny('unsupported requested format refused',r=>r.guestFormat='truffle','UNSUPPORTED_GUEST_FORMAT');
deny('Truffle needs a Graal isolate host',(r,h)=>h.hostKind='native',
  'TRUFFLE_REQUIRES_GRAAL_ISOLATE',[truffle,graal]);
deny('Truffle is stopped at safepoints, not by fuel',(r,h)=>h.preemption='fuel',
  'TRUFFLE_SAFEPOINTS_REQUIRED',[truffle,graal]);
deny('no duplicate capability entries',r=>r.capabilities=['network:read','network:read'],'INVALID_REQUEST_CAPABILITIES');
deny('unexpected limit key refused',(r,h)=>h.limits.extra=1,'INVALID_HOST_LIMITS_FIELDS');
