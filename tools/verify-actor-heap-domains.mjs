// Schema/architecture only: never a substitute for actual compiled Oreslang guest execution.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const expected = {
  "java": {
    "tenantBoundary": "trusted-jvm-process-not-graal-context-sandbox",
    "actorHeap": "actor-owned-offheap-native-arena-and-custom-linear-heap",
    "guestLowering": "NOT_VERIFIED",
    "actorHeapRuntime": "HOST_SUBSTRATE_ONLY"
  },
  "llvm": {
    "tenantBoundary": "isolatevm-tenant-native-regions-not-os-sandbox",
    "actorHeap": "native-actor-owned-arena-per-incarnation",
    "guestLowering": "NOT_VERIFIED",
    "actorHeapRuntime": "HOST_SUBSTRATE_ONLY"
  },
  "wasm": {
    "tenantBoundary": "wasmtime-store-instance-per-tenant-not-process-sandbox",
    "actorHeap": "separate-actor-memory-or-instance-with-owner-checked-regions",
    "guestLowering": "NOT_VERIFIED",
    "actorHeapRuntime": "PARTIAL_HOST_SUBSTRATE"
  },
  "cranelift": {
    "tenantBoundary": "unsupported-tenant-actor-admission",
    "actorHeap": "deny-actor-source-until-native-private-heap-implemented",
    "guestLowering": "UNSUPPORTED_FAIL_CLOSED",
    "actorHeapRuntime": "UNIMPLEMENTED"
  },
  "net": {
    "tenantBoundary": "nativeaot-logical-isolatevm-not-clr-heap-sandbox",
    "actorHeap": "actor-owned-unmanaged-arenas-with-lifetime-pins",
    "guestLowering": "NOT_VERIFIED",
    "actorHeapRuntime": "PARTIAL_HOST_SUBSTRATE"
  },
  "forge": {
    "tenantBoundary": "trusted-host-only-not-process-sandbox",
    "actorHeap": "preallocated-actor-owned-native-scalar-heap",
    "guestLowering": "NOT_VERIFIED",
    "actorHeapRuntime": "PARTIAL_HOST_SUBSTRATE"
  }
};
const required = [
  "distinct-physical-owner-per-actor-incarnation",
  "actor-relative-offset-zero-may-repeat-only-across-domains",
  "deny-foreign-read-write-and-forged-capabilities",
  "one-writer-per-actor-across-suspension",
  "loan-and-continuation-pins-delay-retirement",
  "fence-stale-actor-and-tenant-generations",
  "precharge-bounded-heap-and-aggregate-tenant-quotas",
  "no-partial-write-on-failed-mutation",
  "surviving-actor-progress-after-neighbor-reclaim",
  "no-reclaim-before-physical-carrier-io-and-task-drain",
  "reclaim-at-most-once-and-refund-once",
  "no-pointer-sharing-across-actor-domains"
];
const equalKeys = (obj,keys) => obj !== null && typeof obj === 'object' && !Array.isArray(obj)
    && Object.keys(obj).sort().join('|') === [...keys].sort().join('|');
const deny = msg => { throw new Error('actor-heap-domain-contract: '+msg); };
export function verifyPhysicalActorHeapPolicy(m) {
 if(!equalKeys(m,['schemaVersion','scope','sourceFixture','guestVerifications',
   'trustedProcessIsSecurityBoundary','compilerOnlyOrHostOnlyIsGuestEvidence','requiredSemantics','backends']))
   deny('unexpected root fields');
 if(m.schemaVersion !== 1 || m.scope !== 'actor-heap-physical-domains-six-backend-v1' ||
    m.sourceFixture !== 'fixtures/actor-memory/compiled-guest-v1/two-same-kind-actors.ores')
    deny('incorrect version or source fixture');
 if(m.trustedProcessIsSecurityBoundary !== false || m.compilerOnlyOrHostOnlyIsGuestEvidence !== false ||
    !Array.isArray(m.guestVerifications) || m.guestVerifications.length !== 0)
    deny('unsupported security or guest-verification claim');
 if(!Array.isArray(m.requiredSemantics) ||
    m.requiredSemantics.length !== required.length ||
    m.requiredSemantics.some((x,i)=>x!==required[i])) deny('required safety gate missing or changed');
 if(!equalKeys(m.backends,Object.keys(expected))) deny('missing, renamed or invented backend');
 for(const [name,e] of Object.entries(expected)){
   const x=m.backends[name];
   if(!equalKeys(x,Object.keys(e)) || Object.keys(e).some(key=>x[key]!==e[key]))
      deny('unreviewed actor heap strategy or evidence promotion: '+name);
 }
 return Object.freeze({backendCount:6,guestEvidence:'NOT_EXECUTED',scope:m.scope});
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  try {
    if(process.argv.length!==3) deny('usage: node tools/verify-actor-heap-domains.mjs <policy.json>');
    const result=verifyPhysicalActorHeapPolicy(JSON.parse(readFileSync(process.argv[2],'utf8')));
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=1;}
}
