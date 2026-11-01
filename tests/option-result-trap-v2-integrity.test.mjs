import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdirSync,lstatSync} from "node:fs";
import {resolve,dirname,join,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readPinnedRegular} from "../bin/verify-option-result-trap-receipt.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const prefix="fixtures/option-result-trap/v2/";
const names=["option_scalar","result_scalar","trap_scalar","trap_result_data","trap_cast"];
const negatives=["no_option_to_result","no_result_to_option","no_nested_option_flatten",
  "no_nested_result_flatten","no_trap_result_flatten"];
const sha40=/^[a-f0-9]{40}$/;
const blobSha=bytes=>createHash("sha1")
  .update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
function fixturePath(relative) {
  assert.match(relative,/^fixtures\/option-result-trap\/v2\/(?:negative\/)?[a-z_]+\.ores$/);
  const absolute=resolve(root,relative);
  assert(absolute.startsWith(root+sep),"fixture escaped checkout");
  for(let parent=dirname(absolute);parent!==root;parent=dirname(parent)) {
    const meta=lstatSync(parent);
    assert(meta.isDirectory()&&!meta.isSymbolicLink(),"linked fixture directory");
  }
  return absolute;
}
function validate(manifest,lock) {
  assert.equal(manifest?.schema,"oreslang.option-result-trap.modular/v2");
  assert.equal(manifest?.status,"authored_not_executed");
  assert.deepEqual(manifest?.backends,["java","llvm","wasm","cranelift","net"]);
  assert.equal(lock?.schema,"oreslang.option-result-trap.modular-lock/v2");
  assert.match(lock?.manifest_blob??"",sha40);
  assert.equal(manifest.cases?.length,10);
  assert.equal(lock.cases?.length,10);
  const paths=new Set(),ids=new Set(),pins=new Map();
  for(const pin of lock.cases){
    assert.equal(Object.keys(pin).sort().join(","),"git_blob,id,path");
    assert(typeof pin.id==="string"&&!pins.has(pin.id));
    assert.match(pin.git_blob,sha40);
    pins.set(pin.id,pin);
  }
  for(const c of manifest.cases){
    assert(typeof c?.id==="string"&&!ids.has(c.id),"duplicate case ID");
    assert(typeof c.path==="string"&&!paths.has(c.path),"duplicate path");
    ids.add(c.id);paths.add(c.path);
    const pin=pins.get(c.id);
    assert(pin&&pin.path===c.path,"missing/altered pin");
    if(c.kind==="guest_stdout"){
      assert(c.id==="ORT2-"+c.path.slice(prefix.length,-5).toUpperCase());
      assert(names.includes(c.path.slice(prefix.length,-5)));
      assert(Number.isSafeInteger(c.assertion_count)&&c.assertion_count>0);
      assert.equal(c.assertion_count,c.assertions?.length);
      assert.equal(new Set(c.assertions).size,c.assertion_count);
      assert.equal(c.expected_stdout,
        "ORT2:"+c.path.slice(prefix.length,-5)+":"+"1".repeat(c.assertion_count)+":END");
    }else{
      assert.equal(c.kind,"compile_reject");
      assert.equal(c.must_not_launch_guest,true);
      assert.equal(c.expected_diagnostic_category,"type");
      assert(c.id==="ORT2-NEG-"+c.path.slice((prefix+"negative/").length,-5).toUpperCase());
      assert(negatives.includes(c.path.slice((prefix+"negative/").length,-5)));
    }
  }
  assert.equal(names.filter(n=>paths.has(prefix+n+".ores")).length,names.length);
  assert.equal(negatives.filter(n=>paths.has(prefix+"negative/"+n+".ores")).length,negatives.length);
}
test("ORT v2 fixture-lock pins five modular positives and five negative compiler cases",()=>{
  const manifestBytes=readPinnedRegular(join(root,prefix,"manifest.json"));
  const manifest=JSON.parse(manifestBytes.toString("utf8"));
  const lock=JSON.parse(readPinnedRegular(join(root,prefix,"fixture-lock-v2.json")).toString("utf8"));
  validate(manifest,lock);
  assert.equal(blobSha(manifestBytes),lock.manifest_blob);
  for(const c of manifest.cases){
    const bytes=readPinnedRegular(fixturePath(c.path));
    assert.equal(blobSha(bytes),lock.cases.find(x=>x.id===c.id).git_blob);
    const body=bytes.toString("utf8");
    if(c.kind==="guest_stdout"){
      const labels=[...body.matchAll(/^\s*\/\/ CHECK ([a-z_]+)\s*$/gm)].map(m=>m[1]);
      const emitCount=[...body.matchAll(/^\s*emit\(/gm)].length;
      assert.deepEqual(labels,c.assertions,"source assertions differ from manifest");
      assert.equal(emitCount,c.assertion_count);
      assert(body.includes('stdio.stdout.write("ORT2:'+c.path.slice(prefix.length,-5)+':");'));
      assert(body.includes('stdio.stdout.write(":END");'));
    }else{
      assert.match(body,/fnc invalid\(\): void/);
      assert(!body.includes("stdio.stdout.write("));
    }
  }
  for(const dir of [prefix,prefix+"negative/"]) {
    const local=join(root,dir);
    for(const item of readdirSync(local,{withFileTypes:true})){
      if(!item.name.endsWith(".ores"))continue;
      assert(item.isFile()&&manifest.cases.some(c=>c.path===dir+item.name),
        "unlisted or linked guest program: "+dir+item.name);
    }
  }
});
test("ORT v2 lock rejects duplicate IDs, shifted outputs and absent cases",()=>{
  const fixturePaths=[
    ...names.map(n=>prefix+n+".ores"),
    ...negatives.map(n=>prefix+"negative/"+n+".ores")
  ];
  const manifest={schema:"oreslang.option-result-trap.modular/v2",status:"authored_not_executed",
    backends:["java","llvm","wasm","cranelift","net"],
    cases:fixturePaths.map((path,i)=>i<5?{
      id:"ORT2-"+names[i].toUpperCase(),path,kind:"guest_stdout",
      assertion_count:2,assertions:["first","second"],
      expected_stdout:"ORT2:"+names[i]+":11:END"
    }:{
      id:"ORT2-NEG-"+negatives[i-5].toUpperCase(),path,kind:"compile_reject",
      expected_diagnostic_category:"type",must_not_launch_guest:true
    })};
  const lock={schema:"oreslang.option-result-trap.modular-lock/v2",
    manifest_blob:"a".repeat(40),
    cases:manifest.cases.map(c=>({id:c.id,path:c.path,git_blob:"b".repeat(40)}))};
  validate(manifest,lock);
  for(const mutate of [
    m=>m.cases[0].assertions[0]=m.cases[0].assertions[1],
    m=>m.cases[0].expected_stdout="ORT2:option_scalar:1:END",
    m=>m.cases[0].id=m.cases[1].id,
    m=>m.cases.pop(),
    m=>m.cases[5].expected_diagnostic_category="syntax",
    m=>m.backends[3]="forge",
  ]){
    const m=structuredClone(manifest);
    mutate(m);
    assert.throws(()=>validate(m,lock));
  }
});
