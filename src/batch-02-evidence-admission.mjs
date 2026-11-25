/**
 * Source-free evidence admission oracles for original backlog tasks 17-20.
 * These only validate data shape and internal consistency. No caller-supplied
 * record can independently authenticate an Actions run, compiler, benchmark,
 * formal tool, reviewer or branch-protection policy.
 */
const SHA256=/^[0-9a-f]{64}$/;
const GIT=/^[0-9a-f]{40}$/;
const TOKEN=/^[a-zA-Z0-9_.:/+-]{1,160}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FAMILIES=new Map([
  ["java",new Set(["jvm","graal-native"])],
  ["llvm",new Set(["aot","lto"])],
  ["wasm",new Set(["core","simd128"])],
  ["hdl",new Set(["fpga","asic"])]
]);
const HARDWARE=new Set(["fmax_hz","ii_cycles","lut_count","area_um2","power_mw"]);
const SOFTWARE=new Set(["latency_ns","throughput_per_second","peak_rss_bytes"]);
function need(p,message){if(!p)throw new Error(message);}
function object(v){return v!==null&&typeof v==="object"&&!Array.isArray(v);}
function exact(v,fields,label){
  need(object(v),label+" object required");
  need(Object.keys(v).sort().join("|")===fields.slice().sort().join("|"),
    label+" unexpected/missing fields");
}
function token(v,label){need(typeof v==="string"&&TOKEN.test(v),label+" unsafe identifier");}
function sha(v,re,label){need(typeof v==="string"&&re.test(v),label+" invalid digest");}
function nat(v,label){need(Number.isSafeInteger(v)&&v>=0,label+" nonnegative integer");}
function strictPositive(v,label){need(typeof v==="number"&&Number.isFinite(v)&&v>0,label+" positive finite value");}

/** Benchmarks are software vs hardware, observed vs modeled, never interchangeable. */
export function auditBenchmarkEvidence(r){
  exact(r,["schema","backend","mode","sourceCommit","sourceTree","compilerSha256",
    "toolchainSha256","fixtureSha256","machine","phase","evidence",
    "metric","unit","samples","modelValue","run"],"benchmark");
  need(r.schema===1,"benchmark schema");
  need(FAMILIES.has(r.backend)&&FAMILIES.get(r.backend).has(r.mode),
    "unsupported benchmark backend/mode");
  sha(r.sourceCommit,GIT,"source commit");
  sha(r.sourceTree,GIT,"source tree");
  for(const key of ["compilerSha256","toolchainSha256","fixtureSha256"])
    sha(r[key],SHA256,key);
  token(r.machine,"machine");
  need(r.phase==="heldout","only heldout measurements can be compared");
  need(["MEASURED","MODELED","NOT_RUN","UNSUPPORTED"].includes(r.evidence),
    "benchmark evidence state");
  const hardware=r.backend==="hdl";
  need((hardware?HARDWARE:SOFTWARE).has(r.metric),
    "hardware and software metrics must not mix");
  const units={
    fmax_hz:"Hz",ii_cycles:"cycles",lut_count:"LUT",area_um2:"um2",power_mw:"mW",
    latency_ns:"ns",throughput_per_second:"ops/s",peak_rss_bytes:"bytes"
  };
  need(r.unit===units[r.metric],"benchmark metric unit mismatch");
  if(hardware)need(
    (r.mode==="fpga"&&["fmax_hz","ii_cycles","lut_count","power_mw"].includes(r.metric))||
    (r.mode==="asic"&&["fmax_hz","ii_cycles","area_um2","power_mw"].includes(r.metric)),
    "invalid hardware target metric");
  if(r.evidence==="MEASURED"){
    need(Array.isArray(r.samples)&&r.samples.length>=3&&r.samples.length<=512,
      "bounded raw heldout samples required");
    for(const x of r.samples)strictPositive(x,"raw heldout sample");
    need(r.modelValue===null,"measured results cannot include modeled value");
    exact(r.run,["repo","head","runId","attempt","executedSteps"],"benchmark run");
    need(REPO.test(r.run.repo),"benchmark repository");
    sha(r.run.head,GIT,"benchmark tested head");
    need(r.run.head===r.sourceCommit,"benchmark source/run head mismatch");
    nat(r.run.runId,"run ID");need(r.run.runId>0,"positive run ID");
    nat(r.run.attempt,"run attempt");need(r.run.attempt>0,"positive run attempt");
    nat(r.run.executedSteps,"observed executed steps");
    need(r.run.executedSteps>0,"zero-step CI is not benchmark evidence");
  }else{
    need(r.samples===null&&r.run===null,"unsupported/model-only cannot have execution samples");
    if(r.evidence==="MODELED")strictPositive(r.modelValue,"modeled estimate");
    else need(r.modelValue===null,"unmeasured status must omit values");
  }
  return {classification:"SOURCE_FREE_SCHEMA_CHECK_ONLY",benchmarkCertified:false,
    evidence:r.evidence,kind:hardware?"HARDWARE_PPA":"SOFTWARE_RUNTIME",
    needs:"INDEPENDENT_RAW_ARTIFACT_AND_RUN_ATTESTATION"};
}

/** Must never promote schema/proof claims into verified runtime implementation. */
export function auditAssuranceEvidence(c){
  exact(c,["schema","claim","level","backend","sourceCommit","sourceTree",
    "typeSpecSha256","jsonSchemaSha256","witSha256","contractIrSha256",
    "toolSha256","proofSha256","status","toolSteps","runtimeFixtureSha256"],"assurance");
  need(c.schema===1,"assurance schema");
  token(c.claim,"assurance claim");
  need(["L0","L1","L2","L3","L4"].includes(c.level),"assurance level");
  need(["java","llvm","wasm","embedded","fpga","asic","zorde"].includes(c.backend),
    "assurance backend");
  sha(c.sourceCommit,GIT,"assurance commit");sha(c.sourceTree,GIT,"assurance tree");
  sha(c.typeSpecSha256,SHA256,"type spec");
  sha(c.jsonSchemaSha256,SHA256,"JSON schema");
  if(["L1","L2","L3","L4"].includes(c.level)){
    sha(c.witSha256,SHA256,"WIT contract");
    sha(c.contractIrSha256,SHA256,"contract IR");
  }else need(c.witSha256===null&&c.contractIrSha256===null,
    "L0 cannot claim ABI/IR verification");
  need(["PASS","FAIL","REFUSED","UNSUPPORTED","NOT_RUN","INFRA_FAILED"].includes(c.status),
    "assurance status");
  nat(c.toolSteps,"tool steps");
  if(c.status==="PASS"){
    need(c.toolSteps>0,"zero-step proof cannot pass");
    sha(c.toolSha256,SHA256,"proof tool");
    sha(c.proofSha256,SHA256,"proof output");
    if(["L2","L4"].includes(c.level))
      sha(c.runtimeFixtureSha256,SHA256,"runtime observation");
    else need(c.runtimeFixtureSha256===null,"unexpected runtime fixture");
  }else{
    need(c.proofSha256===null,"non-pass cannot claim proof result");
    if(c.status==="UNSUPPORTED"||c.status==="NOT_RUN")
      need(c.toolSteps===0,"unexecuted evidence cannot contain tool steps");
    need(c.runtimeFixtureSha256===null,"non-pass cannot claim runtime observation");
    need(c.toolSha256===null||SHA256.test(c.toolSha256),
      "invalid optional tool digest");
  }
  // Even PASS here is only a caller-supplied statement, not a proof certificate.
  return {classification:"SOURCE_FREE_SCHEMA_CHECK_ONLY",assuranceCertified:false,
    claimedLevel:c.level,claimedStatus:c.status,
    implementationVerified:"NOT_ATTESTED"};
}

/**
 * Review identity and recorded test steps are prerequisites, not attestations.
 * The only authoritative release certification comes from independently
 * checked GitHub review, protected main rules, exact merge tree and artifacts.
 */
export function auditReleaseEvidence(r){
  exact(r,["schema","repository","prNumber","head","mergeCommit","sourceTree",
    "authorId","mergerId","reviewers","protection","ci"],"release");
  need(r.schema===1&&REPO.test(r.repository),"release repository");
  nat(r.prNumber,"PR");need(r.prNumber>0,"PR number");
  for(const [key,re] of [["head",GIT],["mergeCommit",GIT],["sourceTree",GIT]])
    sha(r[key],re,key);
  nat(r.authorId,"author ID");nat(r.mergerId,"merger ID");
  need(r.authorId>0&&r.mergerId>0,"nonzero identity");
  need(Array.isArray(r.reviewers)&&r.reviewers.length>=1&&r.reviewers.length<=10,
    "independent reviewer required");
  const seen=new Set();
  for(const reviewer of r.reviewers){
    exact(reviewer,["id","state","reviewedHead"],"reviewer");
    nat(reviewer.id,"reviewer ID");
    need(reviewer.id>0&&!seen.has(reviewer.id)&&
      reviewer.id!==r.authorId&&reviewer.id!==r.mergerId,
      "reviewer must be independent");
    need(reviewer.state==="APPROVED","review must be approved");
    need(reviewer.reviewedHead===r.head,"stale-head review denied");
    seen.add(reviewer.id);
  }
  exact(r.protection,["enforced","codeowners","adminVerified"],"release protection");
  need(r.protection.enforced===true&&r.protection.codeowners===true&&
    r.protection.adminVerified===true,"unverified or bypassable protection");
  exact(r.ci,["runId","attempt","testedHead","executedTestSteps","conclusion","artifactSha256"],"release CI");
  nat(r.ci.runId,"CI run");nat(r.ci.attempt,"CI attempt");
  need(r.ci.runId>0&&r.ci.attempt>0,"CI run identity");
  sha(r.ci.testedHead,GIT,"tested head");
  need(r.ci.testedHead===r.mergeCommit,"must test final merge commit, not old PR head");
  nat(r.ci.executedTestSteps,"executed test steps");
  need(r.ci.executedTestSteps>0&&r.ci.conclusion==="success",
    "skipped/failed/zero-step tests denied");
  sha(r.ci.artifactSha256,SHA256,"CI artifact");
  return {classification:"SOURCE_FREE_SCHEMA_CHECK_ONLY",releaseCertified:false,
    independentReviewClaim:"SHAPE_VALID_NOT_AUTHENTICATED",
    required:"LIVE_GITHUB_RULES_REVIEW_ARTIFACT_ATTESTATION"};
}
