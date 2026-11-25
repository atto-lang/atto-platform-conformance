import {createHash} from "node:crypto";
import {readFileSync,lstatSync,realpathSync} from "node:fs";
import {resolve,relative,sep} from "node:path";
export const BACKENDS=Object.freeze(["java","llvm","wasm","forge","net"]);
export const CASE_IDS=Object.freeze(["typed-scalar-match","first-ordered-overlap","exhaustive-bool-no-default","short-record","short-contextual-map","evaluated-map-key-vs-static-field","symbol-map-key","explicit-empty-kinds","concrete-struct-preserved","positional-tuple-preserved","explicit-structural-view","legacy-record-preserved","legacy-on-default","missing-over","missing-on","duplicate-default","default-before-on","guarded-default","overlap-without-first","nonexhaustive-without-default","mixed-map-and-record","ambiguous-empty-tilde","duplicate-record-field","implicit-structural-nominal-view","guarded-legacy-default","duplicate-literal-pattern"]);
const TOP=["schema","status","sourceExtension","contract","upstream","executableParityCertified","backends","backendEvidence","counts","cases"];
const BASE=["id","file","rule","expect","sourceGitBlobSha1","backends","confirmedBackends"];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const shape=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&same(Object.keys(v).sort(),keys.slice().sort());
export function validateAttoSyntaxManifest(m,root){
 const errors=[];
 if(!shape(m,TOP))return ["invalid top-level contract fields"];
 if(m.schema!=="attolang.canonical-match-and-tilde/1"||m.status!=="SOURCE_CONTRACT_ONLY"||m.executableParityCertified!==false)errors.push("certification must remain false");
 if(m.contract!=="docs/ATTO_CANONICAL_MATCH_TILDE_V1.md"||m.sourceExtension!==".atto"||m.upstream!=="ores-truffle-oreslang/oreslang-common-source#254")errors.push("contract identity changed");
 if(!same(m.backends,BACKENDS)||!same(m.backendEvidence,Object.fromEntries(BACKENDS.map(x=>[x,"NOT_EXECUTED"]))))errors.push("fabricated backend execution");
 if(!same(m.counts,{accept:12,reject:14,total:26}))errors.push("wrong fixed counts");
 if(!Array.isArray(m.cases)||m.cases.length!==26)return [...errors,"wrong case count"];
 const ids=[],seen=new Set();
 for(const [i,c] of m.cases.entries()){
  const label="case["+i+"]";
  if(!shape(c,[...BASE,...(c?.expect==="accept"?["expectedExitCode"]:["diagnosticCategory","noGuestArtifactOnReject"])])){errors.push(label+": invalid case shape");continue;}
  ids.push(c.id);if(!CASE_IDS.includes(c.id)||seen.has(c.id))errors.push(label+": unknown/duplicate ID");seen.add(c.id);
  if(!/^[a-z][a-z0-9-]+$/.test(c.rule||""))errors.push(label+": invalid rule");
  if(!same(c.backends,BACKENDS)||!same(c.confirmedBackends,[]))errors.push(label+": fabricated case execution");
  if(c.expect==="accept"){if(c.expectedExitCode!==42)errors.push(label+": positive must exit 42")}
  else if(c.expect==="reject"){if(c.noGuestArtifactOnReject!==true||!/^[A-Z][A-Z0-9_]{3,60}$/.test(c.diagnosticCategory||""))errors.push(label+": invalid rejection gate")}
  else errors.push(label+": invalid expected result");
  if(c.file!==c.id+".atto"||!/^[a-z0-9-]+[.]atto$/.test(c.file||"")){errors.push(label+": unsafe file name");continue;}
  if(!/^[0-9a-f]{40}$/.test(c.sourceGitBlobSha1||""))errors.push(label+": invalid Git blob ID");
  if(root){
   try{
    const parent=resolve(root,"fixtures/atto-canonical-syntax/v1"),file=resolve(parent,c.file),rel=relative(parent,file);
    if(rel.startsWith("..")||rel.includes(sep)||file===parent)throw Error("path traversal");
    const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>65536)throw Error("not a bounded regular file");
    if(realpathSync(file)!==file)throw Error("symlink path");
    const bytes=readFileSync(file),source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    if(source.includes("\r")||source.includes("\0")||!source.includes("pub fnc main()"))throw Error("malformed source");
    const sha=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    if(sha!==c.sourceGitBlobSha1)throw Error("Git blob does not match manifest");
   }catch(e){errors.push(label+": source file invalid: "+e.message)}
  }
 }
 if(!same(ids,CASE_IDS))errors.push("fixed case order changed");
 if(m.cases.filter(x=>x?.expect==="accept").length!==12||m.cases.filter(x=>x?.expect==="reject").length!==14)errors.push("expectation counts changed");
 return errors;
}
