import {test} from "node:test";
import assert from "node:assert/strict";
import {validateSourceExportApproval} from "../bin/require-private-transfer-approval.mjs";

const SHA_A="a".repeat(40),SHA_B="b".repeat(40);
const names={source:"example/private-source",destination:"example/private-carrier"};
const base=()=>({
  schema:"ores.private-ci.source-export/v1",
  ...names,sourceCommit:SHA_A,sourceTree:SHA_B,destinationId:123456,
  requestedBy:"requester",approvedBy:["reviewer-one","reviewer-two"],
  incident22Approval:{incident:22,status:"INDEPENDENTLY_CLEARED",reviewer:"reviewer-one"},
  incident77Approval:{incident:77,status:"INDEPENDENTLY_CLEARED",reviewer:"reviewer-two"},
  createdAtMs:1000,expiresAtMs:2000,
  maxArtifactRetentionDays:1,status:"APPROVED_FOR_EXACT_SOURCE_ONLY"
});
const check=(a=base(),overrides={})=>validateSourceExportApproval({
  approval:a,...names,sourceCommit:SHA_A,sourceTree:SHA_B,
  destinationId:123456,nowMs:1500,...overrides
});
test("source-local structured approval matches only the exact synthetic snapshot",()=>{
  assert.equal(check().status,"EXACT_SOURCE_APPROVAL_STRUCTURE_OK");
});
test("synthetic approval mutations reject replay, missing review and wrong destination",()=>{
  const changes=[
    {sourceCommit:SHA_B},{sourceTree:SHA_A},{destination:"other/private-carrier"},
    {destinationId:123457},{status:"VERIFIED_BACKEND"},
    {approvedBy:["requester","reviewer-two"]},
    {approvedBy:["reviewer-one","reviewer-one"]},
    {approvedBy:["reviewer-one"]},
    {maxArtifactRetentionDays:30},{createdAtMs:2500},
    {expiresAtMs:500},{expiresAtMs:86403000},
    {incident22Approval:{incident:22,status:"OPEN",reviewer:"reviewer-one"}},
    {incident77Approval:{incident:77,status:"INDEPENDENTLY_CLEARED",reviewer:"reviewer-one"}},
    {requesterControlled:true}
  ];
  for(const [i,change] of changes.entries()){
    assert.throws(()=>check({...base(),...change}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/,String(i));
  }
  assert.throws(()=>check(base(),{nowMs:2100}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
  assert.throws(()=>check(base(),{destinationId:123457}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
  assert.throws(()=>check(base(),{sourceTree:SHA_A}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
  assert.throws(()=>check(base(),{sourceCommit:SHA_B}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
  assert.throws(()=>check(base(),{destination:"another/private-carrier"}),/SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED/);
});
