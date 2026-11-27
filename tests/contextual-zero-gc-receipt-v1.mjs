// Contextual allocation receipt shape gate, NOT a certification or trace authenticator.
// Run: node tests/contextual-zero-gc-receipt-v1.mjs
// External CI must authenticate traces, source/artifact provenance and instrumentation independently.
function validateReceipt(receipt, expected) {
  const fail = m => { throw new Error(m); };
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const count = x => Number.isSafeInteger(x) && x >= 0;
  const sha = x => typeof x === "string" && /^[a-f0-9]{40}$/.test(x) && !/^0+$/.test(x);
  const digest = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x) && !/^0+$/.test(x);
  const profiles = ["java-jvm","java-native-image","net-coreclr","net-nativeaot","llvm-native","forge-native","rs-native","rs-wasm","cranelift-native","wasm-worker","js-worker","embedded"];
  const scenarios = {
    main_default:"main", main_reuse:"main", actor_default:"actor", actor_reuse:"actor",
    async_resume:"actor", main_async_resume:"main", oom_no_fallback:"actor", actor_teardown:"actor",
    main_teardown:"main", explicit_host_interop:"host"
  };
  if (!object(expected) || !profiles.includes(expected.profile) || !sha(expected.head) || !sha(expected.tree)) fail("invalid external identity");
  if (!object(receipt) || receipt.version !== 1 || receipt.profile !== expected.profile || receipt.head !== expected.head || receipt.tree !== expected.tree) fail("identity mismatch");
  if (receipt.evidence_kind !== "compiled_guest_execution" || !digest(receipt.artifact_sha256) || receipt.instrumentation !== "allocation-domain-and-host-observation-v1") fail("not an instrumented compiled guest receipt");
  if (!Array.isArray(receipt.cases) || receipt.cases.length !== Object.keys(scenarios).length) fail("missing or extra cases");
  const seen = new Set();
  const traces = new Set();
  for (const c of receipt.cases) {
    if (!object(c) || !Object.hasOwn(scenarios,c.id) || seen.has(c.id) || c.status !== "executed_pass" || !digest(c.trace_sha256)) fail("invalid case");
    seen.add(c.id);
    if (traces.has(c.trace_sha256)) fail("duplicate trace digest");
    traces.add(c.trace_sha256);
    if (c.context !== scenarios[c.id]) fail("wrong allocation context");
    for (const k of ["context_allocations","implicit_host_allocations","explicit_host_allocations","guest_gc_cycles","host_gc_cycles","fallback_allocations","live_bytes_before","live_bytes_after","denied_allocations","iterations","allocated_bytes","released_bytes","peak_live_bytes","outstanding_pins"]) if (!count(c[k])) fail("missing or invalid counter: "+k);
    if (c.implicit_host_allocations || c.guest_gc_cycles || c.fallback_allocations) fail("strict allocation violation");
    if (!c.iterations) fail("empty execution window");
    if (BigInt(c.live_bytes_before) + BigInt(c.allocated_bytes) !== BigInt(c.live_bytes_after) + BigInt(c.released_bytes)) fail("byte ledger mismatch");
    if (c.peak_live_bytes < Math.max(c.live_bytes_before,c.live_bytes_after)) fail("invalid live-byte peak");
    const teardown = c.id === "actor_teardown" || c.id === "main_teardown";
    if (!teardown && c.live_bytes_after !== c.live_bytes_before) fail("unreclaimed contextual bytes");
    if (c.outstanding_pins !== 0) fail("unsettled pins");
    if (c.id === "explicit_host_interop") {
      if (!c.explicit_host_allocations || c.explicit_host_authority !== true) fail("missing authorized exception");
    } else {
      if (c.explicit_host_allocations || c.explicit_host_authority !== false) fail("unexpected host allocation");
      if (!c.context_allocations || !c.allocated_bytes || !c.peak_live_bytes) fail("vacuous allocation case");
    }
    if ((c.id === "actor_reuse" || c.id === "main_reuse") && (c.iterations < 10000 || c.context_allocations < c.iterations)) fail("insufficient reuse stress");
    if (c.id === "oom_no_fallback" && !c.denied_allocations) fail("OOM not exercised");
    if ((c.id === "async_resume" || c.id === "main_async_resume") && c.same_owner_after_resume !== true) fail("continuation owner mismatch");
    if (teardown && (c.live_bytes_before === 0 || c.live_bytes_after !== 0)) fail("teardown incomplete or vacuous");
  }
  return {structurally_admissible:true, certified:false, host_gc_observed:receipt.cases.some(c=>c.host_gc_cycles>0)};
}

function runSelfTests() {
  const expected={profile:"java-jvm",head:"a".repeat(40),tree:"b".repeat(40)};
  const cases=[["main_default","main"],["main_reuse","main"],["actor_default","actor"],["actor_reuse","actor"],["async_resume","actor"],["main_async_resume","main"],["oom_no_fallback","actor"],["actor_teardown","actor"],["main_teardown","main"],["explicit_host_interop","host"]];
  const sample=()=>({version:1,...expected,evidence_kind:"compiled_guest_execution",artifact_sha256:"c".repeat(64),instrumentation:"allocation-domain-and-host-observation-v1",cases:cases.map(([id,context],i)=>{
    const reuse=id.endsWith("_reuse"), teardown=id.endsWith("_teardown"), host=context==="host";
    const n=host?0:reuse?10000:1;
    return {id,context,status:"executed_pass",trace_sha256:(i+1).toString(16).padStart(64,"0"),context_allocations:n,implicit_host_allocations:0,explicit_host_allocations:host?1:0,explicit_host_authority:host,guest_gc_cycles:0,host_gc_cycles:1,fallback_allocations:0,live_bytes_before:teardown?8:0,live_bytes_after:0,allocated_bytes:n*8,released_bytes:n*8+(teardown?8:0),peak_live_bytes:host?0:teardown?16:8,denied_allocations:id==="oom_no_fallback"?1:0,iterations:reuse?10000:1,same_owner_after_resume:true,outstanding_pins:0};
  })});
  let passed=0;
  const valid=validateReceipt(sample(),expected);
  if (!valid.structurally_admissible || valid.certified || !valid.host_gc_observed) throw Error("scope separation failed");
  passed++;
  const find=(r,id)=>r.cases.find(c=>c.id===id);
  const negatives=[
    r=>r.head="e".repeat(40),r=>r.tree="e".repeat(40),r=>r.profile="net-nativeaot",
    r=>r.evidence_kind="host_model",r=>r.artifact_sha256="",r=>r.cases.pop(),
    r=>r.cases[1]=r.cases[0],r=>r.cases[0].status="skipped",r=>r.cases[0].context="host",
    r=>r.cases[0].implicit_host_allocations=1,r=>r.cases[1].guest_gc_cycles=1,
    r=>find(r,"oom_no_fallback").fallback_allocations=1,r=>r.cases[0].context_allocations=0,
    r=>find(r,"actor_reuse").iterations=9999,r=>find(r,"main_reuse").context_allocations=1,
    r=>find(r,"async_resume").same_owner_after_resume=false,r=>find(r,"main_async_resume").same_owner_after_resume=false,
    r=>find(r,"oom_no_fallback").denied_allocations=0,r=>find(r,"actor_teardown").outstanding_pins=1,
    r=>find(r,"main_teardown").live_bytes_after=1,r=>find(r,"explicit_host_interop").explicit_host_authority=false,
    r=>r.cases[1].explicit_host_allocations=1,r=>delete r.cases[0].host_gc_cycles,
    r=>r.cases[0].context_allocations=NaN,r=>r.cases[0].context_allocations=Number.MAX_SAFE_INTEGER+1,
    r=>r.cases[0].trace_sha256="0".repeat(64),r=>r.cases[0].live_bytes_after=1,
    r=>r.cases[0].iterations=0,r=>r.cases[0].released_bytes=0,
    r=>r.cases[0].allocated_bytes=0,r=>r.cases[0].peak_live_bytes=0,
    r=>r.cases[1].trace_sha256=r.cases[0].trace_sha256,r=>r.cases[0].outstanding_pins=1,
    r=>{const c=find(r,"main_teardown");c.live_bytes_before=0;c.released_bytes=c.allocated_bytes;},
    r=>{const c=find(r,"actor_teardown");c.peak_live_bytes=7;},
    r=>{const c=r.cases[0];c.live_bytes_before=Number.MAX_SAFE_INTEGER;c.live_bytes_after=Number.MAX_SAFE_INTEGER;c.allocated_bytes=2;c.released_bytes=1;c.peak_live_bytes=Number.MAX_SAFE_INTEGER;}
  ];
  for (const [i,mutate] of negatives.entries()) {
    const r=sample(); mutate(r); let rejected=false;
    try {validateReceipt(r,expected)} catch {rejected=true}
    if (!rejected) throw Error("negative "+i+" accepted"); passed++;
  }
  return passed;
}

export { validateReceipt, runSelfTests };
console.log("contextual allocation receipt shape self-tests passed:", runSelfTests());
