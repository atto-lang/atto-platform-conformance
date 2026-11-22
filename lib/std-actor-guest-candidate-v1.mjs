// Evaluate completeness of untrusted CI receipts. NEVER return PASS.
import { validateStdActorParity } from './std-actor-parity-v1.mjs';
const sha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const id=n=>Number.isSafeInteger(n)&&n>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const requiredSteps=[
  'Bind test execution to immutable source tree',
  'Compile actual native Atto namespace and relative import',
  'Build exact-head production Atto compiler',
  'Execute source contracts and compiled Wasm actor policy guests',
  'Assert exact-head Rust source tree remained unchanged'
];
const expectedPositive=[
  ['smoke','stdlib/actor/guest_smoke.atto'],
  ['boundaries','stdlib/actor/guest_edges.atto'],
  ['namespacePositive','stdlib/actor/guest_namespace_only.atto']
];
const expectedMutants=[['smoke',1],['smoke',18],['smoke',34],
  ['boundaries',100],['boundaries',166],['boundaries',232]];
const respond=(classification,reason)=>({classification,reason,policyGuestVerified:false,runtimeVerified:false});
const invalid=reason=>respond('EVIDENCE_UNTRUSTED',reason);
export function classifyStdActorGuestCandidate({manifest,backend,expectedHead,run,job,artifact}) {
  validateStdActorParity(manifest);
  if(!Object.hasOwn(manifest.backends,backend))return invalid('UNKNOWN_BACKEND');
  const config=manifest.backends[backend];
  if(config.contractStatus==='NOT_IMPLEMENTED')return respond('NOT_IMPLEMENTED','BOOTSTRAP_COMPILER');
  if(!sha(expectedHead))return invalid('MISSING_EXPECTED_HEAD');
  if(!run||!job)return respond('NOT_EXECUTED','MISSING_RUN_OR_JOB');
  if(!id(run.id)||!id(run.run_attempt)||!id(job.id)||run.head_sha!==expectedHead||
      run.repository?.full_name!==config.repo||job.run_id!==run.id)
    return invalid('UNBOUND_GITHUB_RUN');
  if(run.status!=='completed'||job.status!=='completed')return respond('IN_PROGRESS','INCOMPLETE_RUN');
  if(!Array.isArray(job.steps)||job.steps.length===0)
    return respond('RUNNER_ADMISSION_FAILURE','ZERO_REPORTED_STEPS');
  if(run.conclusion!=='success'||job.conclusion!=='success'||
      job.steps.some(s=>s.conclusion==='failure'||s.conclusion==='cancelled'))
    return respond('EXECUTION_FAILED','FAILED_JOB_OR_STEP');
  if(!id(job.runner_id)||new Set(job.steps.map(s=>s?.name)).size!==job.steps.length||
      new Set(job.steps.map(s=>s?.number)).size!==job.steps.length||
      job.steps.some(s=>!s||!id(s.number)||typeof s.name!=='string'||!s.name))
    return invalid('MALFORMED_STEP_OR_RUNNER');
  for(const name of requiredSteps)
    if(!job.steps.some(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success'))
      return invalid('MISSING_REQUIRED_REAL_COMPILER_STEP');
  if(!artifact||artifact.backend!==backend||artifact.repo!==config.repo||
      artifact.sourceHead!==expectedHead||artifact.compilerHead!==expectedHead||
      artifact.runId!==run.id||artifact.runAttempt!==run.run_attempt||
      !sha(artifact.sourceTree)||typeof artifact.toolchain!=='string'||
      artifact.toolchain.length<3||typeof artifact.target!=='string'||artifact.target.length<3)
    return invalid('MISSING_EXACT_COMPILER_PROVENANCE');
  const blobs=artifact.sourceBlobs;
  if(!blobs||!same(Object.keys(blobs).sort(),
      ['future','namespacePositive','policy','smoke','boundaries'].sort())||
      Object.values(blobs).some(v=>!sha(v)))return invalid('MISSING_SOURCE_BLOBS');
  const positives=artifact.positive;
  if(!positives||!same(Object.keys(positives).sort(),expectedPositive.map(x=>x[0]).sort()))
    return invalid('MISSING_POSITIVE_GUEST');
  for(const [name,path] of expectedPositive) {
    const p=positives[name];
    if(!p||p.fixture!==path||p.compilerExit!==0||p.wasmValid!==true||
       p.guestMainReturn!==42||!same(p.hostImports,[]))
       return invalid('BAD_POSITIVE_WASM_GUEST:'+name);
  }
  const m=artifact.mutations;
  if(!Array.isArray(m)||m.length!==6||
      !same(m.map(x=>[x.fixture,x.injectedCode]),expectedMutants)||
      m.some(x=>x.compilerExit!==0||x.wasmValid!==true||
          x.guestMainReturn!==x.injectedCode||x.guestMainReturn===42||
          !same(x.hostImports,[])))
    return invalid('INVALID_COMPILER_MUTATION_CONTROLS');
  const neg=artifact.negative;
  if(!Array.isArray(neg)||neg.length!==3||
      !same(neg.map(x=>[x.file,x.diagnostic]),
        manifest.guestTests.namespaceNegative.map(x=>[x.file,x.expectedDiagnostic]))||
      neg.some(x=>!id(x.compilerExit)||x.emittedArtifact!==false))
    return invalid('INVALID_COMPILER_NEGATIVES');
  // Untrusted self-reported receipts cannot attest real execution. This is a
  // candidate requiring independent GitHub API, SHA and artifact verification,
  // and says nothing about physical actor shutdown or trusted CONTROL.
  return respond('POLICY_EVIDENCE_CANDIDATE','INDEPENDENT_SOURCE_RUN_ARTIFACT_REVIEW_REQUIRED');
}
