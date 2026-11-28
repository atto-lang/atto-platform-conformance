import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expandQuantityCases} from "./verified-core-quantity-expansion.mjs";
const keys=["ATTO_VERIFIED_TYPED_BINDINGS","ATTO_VERIFIED_SI_PREFIXES","ATTO_VERIFIED_IMPLICIT_MEASURE","ATTO_VERIFIED_CANONICAL_MEASURE"];
test("profile input identity distinguishes explicit and implicit same-count corpora",()=>{
 const saved=keys.map(k=>process.env[k]);
 const work=mkdtempSync(join(tmpdir(),"measure-profile-"));
 try{
  for(const k of keys)delete process.env[k];
  process.env.ATTO_VERIFIED_TYPED_BINDINGS="1";
  const manifest={profile:"verified-core-quantities-v1"};
  const out=[];
  for(const profile of ["typed","prefixes","implicit"]){
    delete process.env.ATTO_VERIFIED_SI_PREFIXES;
    delete process.env.ATTO_VERIFIED_IMPLICIT_MEASURE;
    if(profile==="prefixes")process.env.ATTO_VERIFIED_SI_PREFIXES="1";
    if(profile==="implicit")process.env.ATTO_VERIFIED_IMPLICIT_MEASURE="1";
    const temp=mkdtempSync(join(work,profile+"-"));
    const {fixtures,cases}=expandQuantityCases("",temp,manifest);
    assert.equal(cases.length,36);
    const texts=cases.map(c=>readFileSync(join(fixtures,c.source),"utf8"));
    assert.equal(texts.some(x=>x.includes("define unit")),profile!=="implicit");
    out.push(texts);
  }
  assert.notDeepEqual(out[0],out[1]);
  assert.notDeepEqual(out[1],out[2]);
  process.env.ATTO_VERIFIED_SI_PREFIXES="1";
  assert.throws(()=>expandQuantityCases("",mkdtempSync(join(work,"invalid-")),manifest),/choose exactly one/);
 }finally{
  keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  rmSync(work,{recursive:true,force:true});
 }
});
