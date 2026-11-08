// Source-free registry consistency check, NOT a compiler/guest attestation.
// In particular, this deliberately refuses any PASS value until a new
// authenticated exact-head receipt verifier is reviewed and introduced.
export function validateTaskCaptureRegionRegistry(doc) {
  const fail=(why)=>{throw new Error("TASK_CAPTURE_REGION_V1_INVALID: "+why)};
  const object=(x)=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const backendTargets=["java","llvm","wasm","forge","net"];
  const expected=[
   ["readonly-record-task-reject","d90fea1c7b2db607ebb3b559ec1303ed027910e4","compile-reject"],
   ["owned-struct-task-accept","81217c06fe332064081ebcce0159231b758e165d","compile-accept"],
   ["scalar-copy-task-guest","56513a00517980a322d59eacf56abc5334a304ef","compile-run"]
  ];
  if(!object(doc)||doc.schemaVersion!==1||doc.contract!=="task-capture-region-proof-v1"||doc.status!=="CANDIDATE_NOT_ATTESTED")
   fail("schema/status");
  if(!equal(doc.backendTargets,backendTargets)||doc.sourceForm!==".atto") fail("backend/source identity");
  if(!object(doc.semanticRequirements)||!object(doc.dependencies)||doc.dependencies.relatedConformanceIssue!=="ores-truffle-oreslang/oreslang-platform-conformance#615")
   fail("contract dependencies");
  if(!Array.isArray(doc.compileTimeProofFields)||!Array.isArray(doc.runtimeValidationFields)) fail("proof field shape");
  for(const s of ["source_program_identity","task_expression_identity","ownership_check_epoch","lexical_root","capture_kind","alias_exclusivity","loan_lifetime_region","suspension_effects"]) {
    if(!doc.compileTimeProofFields.includes(s)) fail("missing compile-time proof: "+s);
  }
  for(const s of ["actor_incarnation","allocation_identity","allocation_generation","logical_task_identity","task_generation","loan_id","read_write_mode","retirement_state"]) {
    if(!doc.runtimeValidationFields.includes(s)) fail("missing runtime fence: "+s);
  }
  if(doc.compileTimeProofFields.includes("os_thread_id")||doc.runtimeValidationFields.includes("os_thread_id")||
    !Array.isArray(doc.forbiddenAuthorizationInputs)||!doc.forbiddenAuthorizationInputs.includes("os_thread_id"))
    fail("thread-derived authority forbidden");
  if(!Array.isArray(doc.fixtures)||doc.fixtures.length!==expected.length) fail("missing/extra source fixture");
  const seen=new Set();
  for(let i=0;i<expected.length;i++) {
    const [id,blob,expectation]=expected[i], f=doc.fixtures[i];
    if(!object(f)||seen.has(f.id)||f.id!==id) fail("fixture id collision/order");
    seen.add(id);
    if(f.repository!=="ores-truffle-oreslang/oreslang-source.java"||
        f.sourceCommit!=="e9e9fcfc85ae99b37c211d0d4d84cdf174605cc7"||
        f.path!=="tests/fixtures/task-record-capture-v1/"+id+".atto"||
        f.gitBlob!==blob||f.expectation!==expectation) fail("fixture provenance: "+id);
    if(!object(f.backendEvidence)||!equal(Object.keys(f.backendEvidence).sort(),[...backendTargets].sort())) fail("backend evidence shape: "+id);
    for(const backend of backendTargets) if(f.backendEvidence[backend]!=="NOT_EXECUTED") fail("unearned guest attestation: "+id+"/"+backend);
    if(expectation==="compile-reject") {
      if(f.expectedSemanticDiagnostic!=="independent task capture 'view' contains a non-Send execution capability"||f.rejectBeforeCodegen!==true)
        fail("semantic reject proof: "+id);
    } else if(f.expectedSemanticDiagnostic!==undefined||f.rejectBeforeCodegen!==undefined) fail("positive is not a rejection: "+id);
    if(expectation==="compile-run" ? f.expectedStdout!=="42" : f.expectedStdout!==undefined) fail("guest stdout: "+id);
    if(f.sourceText!==undefined||f.privateSource!==undefined) fail("private code must not be mirrored");
  }
  const gates=doc.promotionGates;
  if(!object(gates)) fail("missing promotion gates");
  for(const key of ["exactSourceHeadAndBlobs","nonzeroJobSteps","compilerOwnedProvenance","semanticDiagnosticNotParserOnly",
    "negativeEmitsNoExecutableIR","positiveCompilerAndGuestControls","physicalRetirementProof","independentReview"])
    if(gates[key]!==true) fail("required gate disabled: "+key);
  for(const key of ["zeroStepCountsAsEvidence","sourceFreeModelCountsAsGuest","hostOnlyCountsAsAOT"])
    if(gates[key]!==false) fail("unearned evidence: "+key);
  return {contract:doc.contract,sourceCommit:doc.fixtures[0].sourceCommit,caseCount:seen.size,executedBackends:0};
}
