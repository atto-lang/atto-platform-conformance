import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateRegistry,validateMember} from "../src/ecosystem-contract.mjs";
const base=JSON.parse(readFileSync(new URL("../integration/repositories.json",import.meta.url),"utf8"));
const clone=()=>structuredClone(base);
test("all 54 owned repositories are inventoried with typed acyclic integration edges",()=>{
  const result=validateRegistry(base);
  assert.equal(result.repositories,54);
  assert.ok(result.links>35);
  for(const r of base.repositories) {
    const member={schemaVersion:1,protocol:"oreslang-ecosystem-integration",repository:`ores-truffle-oreslang/${r.name}`,role:r.role,upstreams:r.upstreams,evidence:"not-attested",note:"Declared integration touchpoints only; no CI or runtime parity is asserted."};
    assert.equal(validateMember(base,member),r.name);
  }
});
test("reject unknown, duplicate, self and cyclic upstreams",()=>{
  let x=clone();x.repositories[0].upstreams=["not-real"];assert.throws(()=>validateRegistry(x),/unknown upstream/);
  x=clone();x.repositories[0].upstreams=[x.repositories[0].name];assert.throws(()=>validateRegistry(x),/self-upstream/);
  x=clone();x.repositories[0].upstreams=["oreslang-source.java","oreslang-source.java"];assert.throws(()=>validateRegistry(x),/duplicate/);
  x=clone();const first=x.repositories[0];const second=x.repositories[1];first.upstreams=[second.name];second.upstreams=[first.name];assert.throws(()=>validateRegistry(x),/circular/);
});
test("reject false attestation and a mismatching member",()=>{
  const x=clone();x.repositories[0].evidence="verified";assert.throws(()=>validateRegistry(x),/unsupported evidence/);
  const r=base.repositories[0];const m={schemaVersion:1,protocol:"oreslang-ecosystem-integration",repository:`ores-truffle-oreslang/${r.name}`,role:r.role,upstreams:["oreslang-source.java"],evidence:"not-attested",note:"Declared integration touchpoints only; no CI or runtime parity is asserted."};
  assert.throws(()=>validateMember(base,m),/drift/);
});
