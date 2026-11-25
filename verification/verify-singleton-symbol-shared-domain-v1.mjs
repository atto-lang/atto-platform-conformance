// Source-free structural oracle only. Do NOT treat this as guest or compiled parity.
const EXTENDS=["contracts/singleton-shared-state-v1.json","oreslang-platform-conformance#656","oreslang-platform-conformance#651"];
const BACKENDS=["java","llvm","net","wasm","forge"];
const INVARIANTS={
  "singletonScope": "application-domain",
  "singletonIdentity": "compiler-resolved-module-and-declaration",
  "perSlotShadowSingletons": "forbidden",
  "singletonInitialization": "exactly-once-complete-publication",
  "singletonFailure": "sticky",
  "defaultSingletonFields": "deep-immutable-or-guarded",
  "mutableStorage": "separate-runtime-owned-shared-region",
  "actorPrivateHeapPointers": "never-shared-raw",
  "actorStateSupervisorOwner": "not-implicit",
  "regionOwner": "exactly-one-runtime-minted-owner",
  "readWrite": "many-readers-or-one-writer",
  "admission": "bounded-writer-fair-nonparking",
  "loanSuspension": "reject-await-select-capture-until-proven",
  "lifecycle": "generation-fenced-stop-and-physical-quiescence",
  "crossIsolate": "coordinator-or-explicit-shared-memory-not-pointer",
  "symbolSyntax": "#name",
  "symbolProcessCore": "immutable-domain-canonical",
  "symbolUserland": "explicit-trusted-domain-publication",
  "symbolLocal": "actor-local-not-wire",
  "symbolInterning": "bounded-nfc-validation",
  "symbolWireDecode": "lookup-only-untrusted",
  "untrustedSymbolAdmission": "recursive-frozen-snapshot-core-allowlist",
  "stringAndSymbol": "distinct-nominal-keys"
};
const CASES=[
  [
    "singleton-canonical-across-actors-and-slices",
    "runtime",
    [
      "one-application-domain-identity",
      "same-compiler-declaration-id",
      "no-slot-shadow-instance"
    ]
  ],
  [
    "singleton-concurrent-first-access-once",
    "runtime",
    [
      "one-initializer",
      "complete-publication",
      "same-identity"
    ]
  ],
  [
    "singleton-sticky-failure",
    "runtime",
    [
      "no-partial-publication",
      "one-attempt",
      "same-error"
    ]
  ],
  [
    "singleton-initializer-cycle",
    "runtime",
    [
      "finite-diagnostic",
      "no-deadlock",
      "no-partial-publication"
    ]
  ],
  [
    "singleton-alias-import-same-cell",
    "runtime",
    [
      "resolved-definition-identity",
      "one-cell"
    ]
  ],
  [
    "singleton-cross-domain-distinct",
    "runtime",
    [
      "tenant-isolation",
      "no-cross-domain-authority"
    ]
  ],
  [
    "singleton-immutable-snapshot-freeze",
    "runtime",
    [
      "deep-immutability",
      "read-only-sharing"
    ]
  ],
  [
    "singleton-mutable-state-guarded",
    "compile",
    [
      "no-raw-mutable-field-alias",
      "critical-read-write-only"
    ]
  ],
  [
    "singleton-state-owner-unique",
    "runtime",
    [
      "exactly-one-owner-token",
      "no-supervisor-implicit-owner"
    ]
  ],
  [
    "singleton-shared-readers",
    "runtime",
    [
      "multiple-readers",
      "no-simultaneous-writer"
    ]
  ],
  [
    "singleton-exclusive-writer",
    "runtime",
    [
      "at-most-one-writer",
      "no-concurrent-readers"
    ]
  ],
  [
    "singleton-writer-queue-fairness",
    "runtime",
    [
      "writer-barrier",
      "bounded-pending-queue",
      "nonparking"
    ]
  ],
  [
    "singleton-owner-transfer-fence",
    "runtime",
    [
      "quiescence-before-transfer",
      "revoke-old-authority",
      "generation-bump"
    ]
  ],
  [
    "singleton-no-borrow-across-await",
    "compile",
    [
      "reject-live-loan-await",
      "reject-capture-escape"
    ]
  ],
  [
    "singleton-cancel-stop-quiescence",
    "runtime",
    [
      "physical-pins-survive-stop",
      "no-stale-publication",
      "finite-cleanup"
    ]
  ],
  [
    "singleton-forged-authority-denied",
    "runtime",
    [
      "runtime-minted-principal",
      "reject-cross-domain-or-incarnation"
    ]
  ],
  [
    "singleton-allocation-not-actor-private-alias",
    "runtime",
    [
      "separate-shared-region",
      "no-raw-actor-heap-pointer"
    ]
  ],
  [
    "singleton-cross-isolate-transport",
    "runtime",
    [
      "explicit-coordinator-or-shared-memory",
      "same-logical-identity",
      "no-pointer-equality-claim"
    ]
  ],
  [
    "symbol-core-canonical-domain",
    "runtime",
    [
      "immutable-canonical-core",
      "same-domain-equality"
    ]
  ],
  [
    "symbol-userland-explicit-publication",
    "runtime",
    [
      "no-automatic-cross-domain-export",
      "allowlist-required"
    ]
  ],
  [
    "symbol-distinct-from-string",
    "runtime",
    [
      "nominal-tagged-equality",
      "separate-map-key-domains"
    ]
  ],
  [
    "symbol-nfc-validated-bounded",
    "runtime",
    [
      "normalized-keys",
      "bounded-memory",
      "failed-admission-no-leak"
    ]
  ],
  [
    "symbol-local-not-exported",
    "runtime",
    [
      "actor-local-identity",
      "not-sendable",
      "not-wire"
    ]
  ],
  [
    "symbol-wire-lookup-only",
    "runtime",
    [
      "no-attacker-controlled-intern",
      "tagged-domain-identity"
    ]
  ],
  [
    "symbol-untrusted-nested-transport",
    "runtime",
    [
      "recursive-snapshot-check",
      "public-core-only-by-default"
    ]
  ],
  [
    "symbol-cross-isolate-semantic-identity",
    "runtime",
    [
      "stable-wire-key",
      "never-wire-raw-pointer"
    ]
  ]
];
export function verifyContract(x){
const fail=(s)=>{throw Error("SINGLETON_DOMAIN_V1: "+s)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(a,b)=>same(Object.keys(a).sort(),b.slice().sort());
if(!x||typeof x!=="object"||Array.isArray(x))fail("root");
if(!keys(x,["schemaVersion","contract","status","extends","backendTargets","scope","invariants","scenarios","evidence","promotion"]))fail("root fields");
if(x.schemaVersion!==1||x.contract!=="singleton-symbol-shared-domain-v1"||x.status!=="candidate-unattested")fail("identity/status");
if(!same(x.extends,EXTENDS)||!same(x.backendTargets,BACKENDS)||x.scope!=="logical-application-domain-not-operating-system-global")fail("dependency/backend/scope");
if(!keys(x.invariants,Object.keys(INVARIANTS))||!same(x.invariants,INVARIANTS))fail("invariants weakened or extended");
if(!Array.isArray(x.scenarios)||x.scenarios.length!==CASES.length)fail("scenario inventory");
for(let i=0;i<CASES.length;i++){
 const y=x.scenarios[i],v=CASES[i];
 if(!y||!keys(y,["id","kind","requires"])||y.id!==v[0]||y.kind!==v[1]||!same(y.requires,v[2]))fail("scenario mismatch: "+v[0]);
}
if(!Array.isArray(x.evidence)||x.evidence.length!==BACKENDS.length)fail("evidence shape");
for(let i=0;i<BACKENDS.length;i++){
 const e=x.evidence[i];
 if(!e||!keys(e,["backend","semanticCompile","guestExecution","crossIsolate","certification"])||
 e.backend!==BACKENDS[i]||e.semanticCompile!=="NOT_EXECUTED"||e.guestExecution!=="NOT_EXECUTED"||
 e.crossIsolate!=="NOT_EXECUTED"||e.certification!=="NOT_CERTIFIED")fail("unattested claim at "+BACKENDS[i]);
}
const p=x.promotion;
if(!p||!keys(p,["sourceFreeOnly","conformant","guestCompilerRequired","guestRuntimeRequired","exactHeadRequired","stepfulRunnerRequired","independentReviewRequired","asANotProofOfRuntime"])||
 p.sourceFreeOnly!==true||p.conformant!==false||p.guestCompilerRequired!==true||p.guestRuntimeRequired!==true||p.exactHeadRequired!==true||
 p.stepfulRunnerRequired!==true||p.independentReviewRequired!==true||p.asANotProofOfRuntime!==true)fail("promotion claim");
return true;
}
