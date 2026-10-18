import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {inspectCheckouts} from "../bin/audit-member-checkouts.mjs";
import {validateRegistry,validateMember} from "../src/ecosystem-contract.mjs";
const spec={schemaVersion:1,organization:"ores-truffle-oreslang",snapshotDate:"2026-10-17",status:"coordination-only",note:"test",repositories:[{name:"contract-only",role:"contract",upstreams:[],evidence:"not-attested"}]};
const member={schemaVersion:1,protocol:"oreslang-ecosystem-integration",repository:"ores-truffle-oreslang/contract-only",role:"contract",upstreams:[],evidence:"not-attested",note:"Declared integration touchpoints only; no CI or runtime parity is asserted."};
test("accept a clean exact-revision member checkout and reject dirty or absent clones",()=>{
  const root=mkdtempSync(join(tmpdir(),"ores-member-"));
  const child=join(root,"contract-only");
  try {
    mkdirSync(join(child,".oreslang"),{recursive:true});
    writeFileSync(join(child,".oreslang","integration.json"),JSON.stringify(member)+"\n");
    execFileSync("git",["init","-q",child]);
    execFileSync("git",["-C",child,"-c","user.name=Audit Test","-c","user.email=audit@example.invalid","add","."]);
    execFileSync("git",["-C",child,"-c","user.name=Audit Test","-c","user.email=audit@example.invalid","commit","-qm","fixture"]);
    const result=inspectCheckouts(spec,root);
    assert.equal(result.checked.length,1);
    assert.equal(result.missing.length,0);
    assert.match(result.checked[0].tree,/^[0-9a-f]{40,64}$/);
    assert.equal(result.evidence,"metadata-only");
    writeFileSync(join(child,"UNTRACKED"),"no");
    assert.throws(()=>inspectCheckouts(spec,root),/dirty worktree/);
    rmSync(child,{recursive:true,force:true});
    assert.throws(()=>inspectCheckouts(spec,root),/missing checkouts/);
    assert.throws(()=>inspectCheckouts(spec,root,{allowMissing:true}),/no checked member/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test("reject unknown member claims and path traversal in inventory",()=>{
  validateRegistry(spec);
  assert.equal(validateMember(spec,member),"contract-only");
  assert.throws(()=>validateMember(spec,{...member,verified:true}),/invalid member contract/);
  assert.throws(()=>validateRegistry({...spec,repositories:[{...spec.repositories[0],name:".."}]}),/invalid repository name/);
  assert.throws(()=>validateRegistry({...spec,repositories:[{...spec.repositories[0],role:"contract",upstreams:["host-a"]},{name:"host-a",role:"host",upstreams:[],evidence:"not-attested"}]}),/core contract must not depend/);
});
