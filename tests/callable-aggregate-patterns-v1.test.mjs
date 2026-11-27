import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {validateManifest,classifyCase} from "../lib/callable-aggregate-patterns-v1.mjs";
const manifest=JSON.parse(fs.readFileSync(new URL("../contracts/callable-aggregate-patterns-v1.json",import.meta.url),"utf8"));
const copy=()=>JSON.parse(JSON.stringify(manifest));
const p=manifest.cases.find(c=>c.id==="tuple-unary-pipe"),n=manifest.cases.find(c=>c.id==="duplicate-leaf");
test("registry baseline, not guest evidence",()=>{assert.deepEqual(validateManifest(manifest),{cases:35,backends:9})});
test("duplicate id",()=>{let m=copy();m.cases[1].id=m.cases[0].id;assert.throws(()=>validateManifest(m))});
test("fabricated baseline",()=>{let m=copy();m.status.java="passed";assert.throws(()=>validateManifest(m))});
test("missing backend",()=>{let m=copy();m.backends.pop();assert.throws(()=>validateManifest(m))});
test("unsupported oracle",()=>{let m=copy();m.cases.find(c=>c.expect==="reject").diagnostic_family="unsupported";assert.throws(()=>validateManifest(m))});
test("missing execution",()=>assert.equal(classifyCase(p,{status:0,stdout:"13",stderr:""}),"not_executed"));
test("exact stdout",()=>assert.equal(classifyCase(p,{executed:true,status:0,stdout:"13",stderr:""}),"candidate_pass"));
test("wrong stdout",()=>assert.equal(classifyCase(p,{executed:true,status:0,stdout:"15",stderr:""}),"failed"));
test("unsupported distinct",()=>assert.equal(classifyCase(n,{executed:true,status:1,stdout:"",stderr:"E_UNSUPPORTED duplicate patterns"}),"unsupported"));
test("negative admitted",()=>assert.equal(classifyCase(n,{executed:true,status:0,stdout:"",stderr:"duplicate"}),"failed"));
test("unrelated negative",()=>assert.equal(classifyCase(n,{executed:true,status:1,stdout:"",stderr:"unrelated syntax"}),"failed"));
test("semantic negative candidate",()=>assert.equal(classifyCase(n,{executed:true,status:1,stdout:"",stderr:"duplicate binding"}),"candidate_pass"));
test("signal inconclusive",()=>assert.equal(classifyCase(p,{executed:true,status:null,signal:"SIGTERM"}),"inconclusive"));

test("negative partial output is not a clean rejection",()=>assert.equal(classifyCase(n,{executed:true,status:1,stdout:"emitted artifact",stderr:"duplicate binding"}),"failed"));
test("missing or malformed streams are inconclusive",()=>{
  for(const r of [
    {executed:true,status:1,stderr:"duplicate binding"},
    {executed:true,status:1,stdout:"",stderr:["duplicate binding"]},
    {executed:true,status:0,stdout:"13"},
    {executed:true,status:1,stdout:null,stderr:"duplicate binding"},
    {executed:true,status:256,stdout:"",stderr:"duplicate binding"}
  ]) assert.equal(classifyCase(n,r),"inconclusive");
});
