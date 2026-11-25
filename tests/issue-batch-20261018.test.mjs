import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const batch=JSON.parse(await readFile(
  new URL("../integration/issue-batch-20261018.json",import.meta.url),"utf8"));

test("October issue batch covers 30 unique existing issue refs across 20 distinct repositories",()=>{
 assert.equal(batch.schemaVersion,1);
 assert.equal(batch.organization,"ores-truffle-oreslang");
 assert.equal(batch.repositories.length,20);
 const seen=new Set();
 let issues=0;
 for(const row of batch.repositories){
  assert.match(row.repository,/^ores-truffle-oreslang\/[A-Za-z0-9._-]+$/);
  assert.equal(seen.has(row.repository),false,"duplicate repo");
  seen.add(row.repository);
  assert.equal(row.branch,"draft/issue-batch-"+row.issues.map(x=>x.number).join("-")+"-20261018");
  assert.ok(["partial-draft-pr","merged-partial-pr","branch-created-only"].includes(row.status));
  assert.equal(Object.hasOwn(row,"draftPullRequest"),row.status==="partial-draft-pr");
  assert.equal(Object.hasOwn(row,"mergedPullRequest"),row.status==="merged-partial-pr");
  if(row.status==="merged-partial-pr")assert.match(row.mergedPullRequest,/\/pull\/\d+$/);
  for(const issue of row.issues){
   assert.ok(Number.isSafeInteger(issue.number)&&issue.number>0);
   assert.equal(issue.url,"https://github.com/"+row.repository+"/issues/"+issue.number);
   issues++;
  }
 }
 assert.equal(issues,30);
 const statuses=batch.repositories.map(x=>x.status);
 assert.equal(statuses.filter(x=>x==="partial-draft-pr").length,14);
 assert.equal(statuses.filter(x=>x==="merged-partial-pr").length,6);
 assert.equal(statuses.filter(x=>x==="branch-created-only").length,0);
});

test("branch setup and draft PRs are not misreported as certified implementations",()=>{
 assert.equal(batch.documentationOnly,true);
 assert.equal(batch.releaseCertified,false);
 assert.ok(batch.repositories.every(x=>x.status!=="done"&&x.status!=="merged"));
});
