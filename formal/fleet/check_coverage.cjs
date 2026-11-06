"use strict";
const EXPECTED=["3fa-app","akrion-sim","atto-mq","atto-xp","beamgraph","chapter-publishing","claimgraph","claritas-viz","declarative-migrations","embedded-alerts","fanwaave","fiducia-cloud","file-tunnel","flags-2-env","gha-indie-worker","graal-show","hacker-house-medellin","hhaus-org","honeypot-r-us","hypesiege","iso-lattes","messaging-intel","numerics-atto","okla-platform","opto-sync","ores-chat","ores-convo","ores-crm","ores-data-platform","ores-devex","ores-dnd","ores-forms","ores-legal","ores-llm","ores-otel","ores-redis-lru-cache","ores-stack","ores-time-series","ores-truffle-oreslang","ores-wasm-loaders","orestra","praxonne","quaestor-ledger","shared-auth","sonus-auris","takoda-automation","usa-acc","voxletra","wasm-xprs","zed-pkg"];
const STATES=new Set(["not-audited","access-unconfirmed","existing-work-under-review","source-model-draft","model-checked","guest-verified"]);
function must(condition,message){if(!condition)throw Error("fleet formal registry: "+message);}
function validate(data){
 must(data && data.schema_version===1,"schema version");
 must(data.evidence_policy?.zero_step_is_not_execution===true,"zero step policy");
 must(data.evidence_policy?.guest_requires_compiler_and_executed_steps===true,"guest policy");
 must(data.evidence_policy?.source_model_is_not_implementation_refinement===true,"model claim policy");
 must(Array.isArray(data.organizations),"organizations must be array");
 const names=data.organizations.map(x=>x.organization);
 must(JSON.stringify(names)===JSON.stringify(EXPECTED),"coverage mismatch / missing, duplicated or out-of-order organization");
 for(const x of data.organizations){
  must(x.request==="formal-only"||x.request==="formal+atto","unknown goal for "+x.organization);
  must(typeof x.target==="string"&&x.target.length>=12,"missing semantic target for "+x.organization);
  must(STATES.has(x.status),"unknown verification state");
  if(["source-model-draft","existing-work-under-review"].includes(x.status))
   must(typeof x.review_url==="string" && x.review_url.startsWith("https://github.com/"),"missing review URL");
  if(x.status==="guest-verified"){
   const e=x.executed_evidence;
   must(e && /^[a-f0-9]{40}$/.test(e.head) && /^[a-f0-9]{64}$/.test(e.artifact_sha256),"missing exact-head guest evidence");
   must(e.compiler_backend && e.compiler_source_revision && Array.isArray(e.executed_steps)&&e.executed_steps.length>0,"zero-step/host-only cannot be guest");
   must(e.independent_review===true && e.negative_fixtures_passed===true,"review/negative proof absent");
  }
 }
 return {organizations:names.length,sourceModelDrafts:data.organizations.filter(x=>x.status==="source-model-draft").length,guestVerified:data.organizations.filter(x=>x.status==="guest-verified").length};
}
if(typeof require==="function" && require.main===module){
 const fs=require("node:fs");
 const registry=JSON.parse(fs.readFileSync(__dirname+"/coverage.v1.json","utf8"));
 const result=validate(registry);
 // Negative mutations: no silently omitted org, zero-step promotion, or forged review.
 const absent=structuredClone(registry);absent.organizations.pop();
 const zero=structuredClone(registry);zero.organizations[0].status="guest-verified";
 const forged=structuredClone(registry);forged.organizations[0].status="source-model-draft";delete forged.organizations[0].review_url;
 for(const bad of [absent,zero,forged]){
  let denied=false;try{validate(bad);}catch{denied=true;}
  must(denied,"negative mutation accepted");
 }
 console.log(JSON.stringify(result));
}
