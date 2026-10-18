import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {auditRepository,auditCodeowners,auditRequiredChecks,auditProtection} from "../bin/audit-private-ci-bootstrap.mjs";

const repo="ores-truffle-oreslang/oreslang-source.llvm";
const JAVA_REPO="ores-truffle-oreslang/oreslang-source.java";
const javaCodeowners=[
  "/.github/workflows/ @ORESoftware",
  ...["/.github/CODEOWNERS","/.github/private-ci-approved-repositories.txt","/.github/private-ci-approved-source-snapshots.txt","/.github/private-ci-independent-reviewer.json","/.github/private-ci-required-checks.json","/.github/workflows/private-ci-mirror-preflight.yml","/.github/workflows/private-ci-policy.yml","/.github/workflows/private-exact-candidate-validation.yml","/.github/workflows/private-exact-main-validation.yml","/.github/workflows/private-exact-publisher-validation.yml","/docs/security/CI_PRIVATE_SOURCE_MIRRORING.md","/docs/security/PRIVATE_CI_POLICY_INTEGRATION_REVIEW_2026-10-16.md","/docs/security/PRIVATE_EXACT_MAIN_VALIDATION.md","/docs/security/PRIVATE_CI_REVIEW_PINNED_EXTERNAL_ADMISSION.md","/scripts/check-private-ci-destination.sh","/scripts/publish-private-ci-source.py","/scripts/run-in-private-ci-destination.sh","/scripts/test-private-ci-destination.sh","/scripts/test-publish-private-ci-source.py","/scripts/ci_private_mirror_preflight.py","/scripts/verify-review-pinned-private-ci.py","/scripts/dispatch-review-pinned-private-ci.py","/tests/test_ci_private_mirror_preflight.py","/tests/test_review_pinned_private_ci.py","/tests/test_review_pinned_dispatcher.py","/src/test/java/dev/oreslang/PrivateExactMainValidationWorkflowSecurityTest.java","/src/test/java/dev/oreslang/PrivateExactPublisherAdmissionMutationTest.java","/src/test/java/dev/oreslang/PrivateExactPublisherValidationWorkflowSecurityTest.java"].map(path=>path+" @ORESoftware")
].join("\n")+"\n";
const javaChecks=JSON.stringify({
  schema:1,
  source:{context:"private-ci-policy",appId:15368},
  carrier:{context:"carrier-policy",appId:15368}
})+"\n";
const SHA="a".repeat(40);
const owner="@ORESoftware";
const codeowners=[
  "/.github/CODEOWNERS "+owner,
  "/.github/private-ci-approved-repositories.txt "+owner,
  "/.github/private-ci-approved-source-snapshots.txt "+owner,
  "/.github/private-ci-required-checks.json "+owner,
  "/.github/workflows/private-ci-policy.yml "+owner
].join("\n")+"\n";
const checks=JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:15368}]})+"\n";
const empty="# no approvals during bootstrap\n";
const workflow="name: Private CI export policy\n";
const protection=()=>({
  enforce_admins:{enabled:true},
  allow_force_pushes:{enabled:false},
  allow_deletions:{enabled:false},
  required_status_checks:{strict:true,contexts:[],checks:[
    {context:"private-ci-policy",app_id:15368},
    {context:"other-security-check",app_id:15368}
  ]},
  required_pull_request_reviews:{
    require_code_owner_reviews:true,
    dismiss_stale_reviews:true,
    required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}
  }
});
function encoded(text){
  const raw=Buffer.from(text);
  return {type:"file",encoding:"base64",content:raw.toString("base64"),
    sha:createHash("sha1").update("blob "+raw.length+"\0").update(raw).digest("hex")};
}
function fixture(overrides={},calls=[],repository=repo){
  let branchReads=0, protectionReads=0, identityReads=0;
  return async (url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,"GET");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,"Bearer test-token");
    const base="https://api.github.com/repos/"+repository;
    if(url===base){
      identityReads++;
      const value=overrides.identity;
      const expected={
        id:repository===JAVA_REPO?1400792274:1410897874,
        full_name:repository,private:true,visibility:"private",
        archived:false,disabled:false
      };
      const custom=typeof value==="function"?value(identityReads,expected):value;
      return {status:200,json:async()=>custom??expected};
    }
    if(url===base+"/branches/main"){
      branchReads++;
      const custom=overrides.branch;
      if(typeof custom==="function") return {status:200,json:async()=>custom(branchReads)};
      return {status:200,json:async()=>custom??{name:"main",protected:true,commit:{sha:SHA}}};
    }
    if(url===base+"/branches/main/protection" && typeof overrides.protection==="function"){
      protectionReads++;
      return {status:200,json:async()=>overrides.protection(protectionReads)};
    }
    const table={
      [base+"/branches/main/protection"]:overrides.protection??protection(),
      [base+"/contents/.github/CODEOWNERS?ref="+SHA]:encoded(overrides.codeowners??codeowners),
      [base+"/contents/.github/private-ci-approved-repositories.txt?ref="+SHA]:encoded(overrides.destinations??empty),
      [base+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+SHA]:encoded(overrides.snapshots??empty),
      [base+"/contents/.github/private-ci-required-checks.json?ref="+SHA]:encoded(overrides.checks??checks),
      [base+"/contents/.github/workflows/private-ci-policy.yml?ref="+SHA]:encoded(overrides.workflow??workflow)
    };
    const value=table[url];
    if(!value) return {status:404,json:async()=>({message:"not found"})};
    if(value.status) return {status:value.status,json:async()=>value.data};
    return {status:200,json:async()=>value};
  };
}
const run=(overrides={},calls=[])=>auditRepository(repo,{token:"test-token",fetchImpl:fixture(overrides,calls)});

test("accepts strict protected-main bootstrap with empty export approvals",async()=>{
  const result=await run();
  assert.deepEqual(result,{
    repo,status:"BOOTSTRAP_PROTECTED",protectedSha:SHA,
    requiredCheck:"private-ci-policy",requiredCheckAppId:15368
  });
});

test("source repository identity is pinned before branch policy reads",async()=>{
  for(const change of [
    {id:99999999},
    {full_name:"ores-truffle-oreslang/replaced-repo"},
    {private:false,visibility:"public"},
    {private:true,visibility:"public"},
    {archived:true},
    {disabled:true},
    {id:"1410897874"}
  ]){
    const calls=[];
    const expected={
      id:1410897874,full_name:repo,private:true,visibility:"private",
      archived:false,disabled:false
    };
    await assert.rejects(run({identity:{...expected,...change}},calls),
      /immutable source identity, privacy or active state mismatch/);
    assert.equal(calls.length,1, "untrusted slug must not reach branch policy reads");
  }
});

test("source privacy or numeric ID drift during audit must fail closed",async()=>{
  for(const change of [
    {private:false,visibility:"public"},
    {id:99999999},
    {archived:true}
  ]){
    const calls=[];
    await assert.rejects(run({identity:(read,expected)=>
      read===1?expected:{...expected,...change}},calls),
      /immutable source identity, privacy or active state mismatch/);
    assert.equal(calls[0].url,"https://api.github.com/repos/"+repo);
    assert.equal(calls.at(-1).url,"https://api.github.com/repos/"+repo);
  }
});

test("unprotected main fails before protection or policy files are read",async()=>{
  const calls=[];
  await assert.rejects(run({branch:{name:"main",protected:false,commit:{sha:SHA}}},calls),/main is not protected/);
  assert.equal(calls.length,2); // identity first, then main branch; no policy read
});

test("review, admin enforcement and bypass requirements fail closed",()=>{
  for(const bad of [
    {...protection(),enforce_admins:{enabled:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,require_code_owner_reviews:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,dismiss_stale_reviews:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,required_approving_review_count:0}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,bypass_pull_request_allowances:{users:[{login:"owner"}],teams:[],apps:[]}}}
  ]) assert.throws(()=>auditProtection(bad),/protection mismatch/);
});

test("force pushes and branch deletion exceptions must fail closed",()=>{
  for(const setting of ["allow_force_pushes","allow_deletions"]){
    for(const invalid of [undefined,null,{}, {enabled:true},{enabled:"false"}]){
      assert.throws(()=>auditProtection({...protection(),[setting]:invalid}),
        /review\/admin\/no-bypass protection mismatch/);
    }
  }
});

test("required check must be strict and bound to GitHub Actions app 15368",()=>{
  const base=protection();
  assert.doesNotThrow(()=>auditRequiredChecks(checks,base));
  assert.throws(()=>auditRequiredChecks(checks,{...base,required_status_checks:{strict:true,contexts:[],checks:[{context:"private-ci-policy",app_id:999}]}}),/check\/app binding/);
  assert.throws(()=>auditRequiredChecks(checks,{...base,required_status_checks:{strict:false,contexts:[],checks:[{context:"private-ci-policy",app_id:15368}]}}),/strict app-bound/);
  assert.throws(()=>auditRequiredChecks(JSON.stringify({schema:1,checks:[{context:"other",appId:15368}]}),base),/identity mismatch/);
});

test("final CODEOWNERS block cannot be shadowed by a later wildcard",()=>{
  assert.doesNotThrow(()=>auditCodeowners(codeowners));
  assert.throws(()=>auditCodeowners(codeowners+"* @someone-else\n"),/final block mismatch/);
  assert.throws(()=>auditCodeowners(codeowners.replace(owner,"@someone-else")),/final block mismatch/);
});

test("bootstrap refuses destination or source snapshot authorization",async()=>{
  await assert.rejects(run({destinations:"private-org/carrier 1234\n"}),/destination approval must remain empty/);
  await assert.rejects(run({snapshots:"b".repeat(40)+" "+"c".repeat(40)+" 1234\n"}),/snapshot approval must remain empty/);
});

test("protected-main drift during audit is rejected",async()=>{
  await assert.rejects(run({branch:n=>({name:"main",protected:true,commit:{sha:n===1?SHA:"b".repeat(40)}})}),/changed during audit/);
});

test("missing protection metadata and transport failures deny without leaking token",async()=>{
  await assert.rejects(run({protection:{status:403,data:{message:"forbidden"}}}),/metadata unavailable/);
  await assert.rejects(auditRepository(repo,{token:"test-token",fetchImpl:async()=>{throw Error("Bearer test-token");}}),err=>{
    assert.equal(err.message.includes("test-token"),false);
    assert.match(err.message,/policy lookup failed/);
    return true;
  });
});

test("missing credentials fail before any network request",async()=>{
  let calls=0;
  await assert.rejects(auditRepository(repo,{token:"",fetchImpl:async()=>{calls++;}}),/token required/);
  assert.equal(calls,0);
});

test("Java preserves extended terminal ownership plus wildcard and source/carrier issuer pins",async()=>{
  assert.doesNotThrow(()=>auditCodeowners(javaCodeowners,JAVA_REPO));
  assert.doesNotThrow(()=>auditRequiredChecks(javaChecks,protection(),JAVA_REPO));
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/.github/workflows/ @ORESoftware",""),JAVA_REPO),/final block missing/);
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/.github/workflows/ @ORESoftware",
    "/.github/workflows/ @Unreviewed"),JAVA_REPO),/wildcard missing/);
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/scripts/publish-private-ci-source.py @ORESoftware",
    "/scripts/publish-private-ci-source.py @Unreviewed"),JAVA_REPO),/final block mismatch/);
  assert.throws(()=>auditRequiredChecks(JSON.stringify({
    schema:1,source:{context:"private-ci-policy",appId:15368},
    carrier:{context:"carrier-policy",appId:15369}
  }),protection(),JAVA_REPO),/issuer policy identity mismatch/);
  assert.throws(()=>auditRequiredChecks(checks,protection(),JAVA_REPO),/issuer policy identity mismatch/);
  await assert.rejects(auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:codeowners,checks:javaChecks},[],JAVA_REPO)
  }),/final block missing/);
  const result=await auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:javaCodeowners,checks:javaChecks},[],JAVA_REPO)
  });
  assert.equal(result.repo,JAVA_REPO);
  assert.equal(result.status,"BOOTSTRAP_PROTECTED");
});

test("Java CODEOWNERS requires dispatcher code and regression test in exact terminal order",()=>{
  assert.doesNotThrow(()=>auditCodeowners(javaCodeowners,JAVA_REPO));
  for(const path of [
    "/scripts/dispatch-review-pinned-private-ci.py",
    "/tests/test_review_pinned_dispatcher.py"
  ]){
    const entry=path+" @ORESoftware\n";
    assert.ok(javaCodeowners.includes(entry));
    assert.throws(()=>auditCodeowners(javaCodeowners.replace(entry,""),JAVA_REPO),
      /security CODEOWNERS final block mismatch|security CODEOWNERS final block missing/);
    assert.throws(()=>auditCodeowners(javaCodeowners.replace(
      entry,path+" @Unreviewed\n"),JAVA_REPO),
      /security CODEOWNERS final block mismatch/);
  }
  const lines=javaCodeowners.split("\n");
  const a=lines.indexOf("/scripts/dispatch-review-pinned-private-ci.py @ORESoftware");
  const b=lines.indexOf("/tests/test_review_pinned_dispatcher.py @ORESoftware");
  assert.ok(a>0 && b>a);
  [lines[a],lines[b]]=[lines[b],lines[a]];
  assert.throws(()=>auditCodeowners(lines.join("\n"),JAVA_REPO),/final block mismatch/);
});

test("missing or malformed bypass allowance arrays deny bootstrap",()=>{
  const r=protection().required_pull_request_reviews;
  for(const bypass of [
    {},{users:[]},{users:[],teams:[]},
    {users:[],teams:[],apps:null},{users:"",teams:[],apps:[]},
    {users:[],teams:{length:0},apps:[]},
    {users:[],teams:[],apps:""}
  ]) assert.throws(()=>auditProtection({...protection(),
    required_pull_request_reviews:{...r,bypass_pull_request_allowances:bypass}
  }),/protection mismatch/);
});

test("missing, null, or untrusted legacy required contexts deny bootstrap",()=>{
  const p=protection(),{contexts,...rest}=p.required_status_checks;
  for(const checksMetadata of [rest,{...rest,contexts:null},
    {...rest,contexts:""},{...rest,contexts:[],strict:false}
  ]) assert.throws(()=>auditRequiredChecks(checks,
    {...p,required_status_checks:checksMetadata}),/strict app-bound/);
});

test("unlisted repository cannot impersonate a bootstrap source",async()=>{
  let calls=0;
  await assert.rejects(auditRepository("attacker-org/lookalike",{
    token:"test-token",fetchImpl:async()=>{calls++;throw Error("unexpected request");}
  }),/source repository is not allowlisted/);
  assert.equal(calls,0);
});

test("force-push permission enabled mid-audit denies the same protected SHA",async()=>{
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),allow_force_pushes:{enabled:true}
  }}),/review\/admin\/no-bypass protection mismatch/);
});

test("review or issuer protection revoked without moving main fails closed",async()=>{
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),enforce_admins:{enabled:false}
  }}),/review\/admin\/no-bypass/);
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),required_status_checks:{strict:true,contexts:[],
      checks:[{context:"private-ci-policy",app_id:999}]}
  }}),/check\/app binding/);
});
