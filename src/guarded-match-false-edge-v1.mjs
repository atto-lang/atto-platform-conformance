// Source-free candidate manifest checker; it cannot attest compiled guest behavior.
// Deliberately refuses all PASS labels until an authenticated exact-head receipt
// verifier has been independently reviewed and introduced as a separate change.
export function validateGuardedMatchManifest(m) {
  const die=(reason)=>{throw Error("GUARDED_MATCH_MANIFEST_INVALID: "+reason)};
  const obj=(v)=>v!==null && typeof v==="object" && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const targets=["java","llvm","wasm","forge","net"];
  const source="ores-truffle-oreslang/oreslang-source.java";
  const commit="56a5ca3a67b13388e4b7e441f10743005e8340b2";
  const expected=[
    ["reject-statement-guard-move","13b6a8cca706241c3bd56b456f0828ab0253d61b","semantic-reject"],
    ["reject-value-guard-move","693e0bcf6d9fd4d54d9f9c92175e1bf09716d648","semantic-reject"],
    ["accept-borrowed-match-guard","55524f255e1adbf8f3435986f3446ae896ab7013","compile-and-run"]
  ];
  if(!obj(m)||m.schemaVersion!==1||m.contract!=="guarded-match-ownership-false-edge-v1"||m.status!=="CANDIDATE_NOT_ATTESTED")die("schema/status");
  if(m.sourceRepository!==source||m.exactSourceCommit!==commit||m.language!==".atto")die("source identity");
  if(m.referenceImplementation!=="ores-truffle-oreslang/oreslang-source.java#2691"||m.trackedIssue!=="ores-truffle-oreslang/oreslang-platform-conformance#615")die("coordination refs");
  if(!same(m.backendTargets,targets))die("backend identities");
  if(!obj(m.requirements))die("semantic requirements");
  for(const key of ["orderedArms","guardFalseEffect","patternSkip","branchBodyIsolation","valueMatch","borrowedPositive","semanticNegative","guestPositive","futureProof"]){
    if(typeof m.requirements[key]!=="string"||m.requirements[key].length<40)die("missing semantic rule: "+key);
  }
  if(!Array.isArray(m.fixtureProvenance)||m.fixtureProvenance.length!==3)die("fixture count");
  const seen=new Set();
  for(let i=0;i<expected.length;i++){
    const [id,hash,kind]=expected[i],fixture=m.fixtureProvenance[i];
    if(!obj(fixture)||seen.has(fixture.id)||fixture.id!==id)die("fixture identity/order");
    seen.add(id);
    if(fixture.repository!==source||fixture.commit!==commit||
      fixture.path!=="tests/fixtures/ownership-match-guard-v1/"+id+".atto"||
      fixture.gitBlobSha1!==hash||fixture.expected!==kind)die("source blob changed: "+id);
    if(!obj(fixture.backendEvidence)||!same(Object.keys(fixture.backendEvidence).sort(),[...targets].sort()))die("backend evidence shape: "+id);
    for(const backend of targets)if(fixture.backendEvidence[backend]!=="NOT_EXECUTED")die("unearned executed receipt: "+id+"/"+backend);
    if(kind==="semantic-reject"){
      if(fixture.parseMustSucceed!==true||fixture.semanticDiagnostic!=="moved"||fixture.negativeEmitsNoExecutableIR!==true)die("negative proof conditions: "+id);
      if(fixture.expectedStdout!==undefined)die("negative stdout");
    }else{
      if(fixture.expectedStdout!=="7"||fixture.parseMustSucceed!==undefined||
       fixture.semanticDiagnostic!==undefined||fixture.negativeEmitsNoExecutableIR!==undefined)die("positive guest control");
    }
    for(const forbidden of ["sourceText","rawSource","privateSource","runPassed","attestation","evidenceUrl"]){
      if(Object.prototype.hasOwnProperty.call(fixture,forbidden))die("untrusted source/evidence field: "+forbidden);
    }
  }
  if(!obj(m.promotion))die("promotion object");
  for(const key of ["exactHeadAndBlobShaRequired","executedCompilerAndGuestStepsRequired","semanticRejectAfterParseRequired",
    "positiveGuestControlRequired","independentReviewRequired","noPrivateSourceReplication","wasmWorkerAdditionalGate"]){
    if(m.promotion[key]!==true)die("required gate disabled: "+key);
  }
  for(const key of ["zeroStepCountsAsEvidence","hostOnlyCountsAsGuest","metadataOnlyCountsAsProof"]){
    if(m.promotion[key]!==false)die("unearned evidence gate: "+key);
  }
  if(!same(m.promotion.nativeAotAdditionalGateFor,["java","net"])||!same(m.promotion.nativeSanitizersAdditionalGateFor,["llvm","forge"]))die("target qualification gates");
  if(!Array.isArray(m.caveats)||m.caveats.length<4||m.caveats.some(x=>typeof x!=="string"||x.length<40))die("known evidence limitations");
  return {sourceCommit:commit,fixtures:seen.size,executedBackends:0,status:m.status};
}
