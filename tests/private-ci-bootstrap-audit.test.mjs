import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {auditRepository,auditCodeowners,auditRequiredChecks,auditProtection} from "../bin/audit-private-ci-bootstrap.mjs";

const repo="ores-truffle-oreslang/oreslang-source.java";
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
function fixture(overrides={},calls=[]){
  let branchReads=0;
  return async (url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,"GET");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,"Bearer test-token");
    const base="https://api.github.com/repos/"+repo;
    if(url===base+"/branches/main"){
      branchReads++;
      const custom=overrides.branch;
      if(typeof custom==="function") return {status:200,json:async()=>custom(branchReads)};
      return {status:200,json:async()=>custom??{name:"main",protected:true,commit:{sha:SHA}}};
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

test("unprotected main fails before protection or policy files are read",async()=>{
  const calls=[];
  await assert.rejects(run({branch:{name:"main",protected:false,commit:{sha:SHA}}},calls),/main is not protected/);
  assert.equal(calls.length,1);
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
