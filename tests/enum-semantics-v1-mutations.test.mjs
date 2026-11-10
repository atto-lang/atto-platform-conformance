import test from "node:test";
import {execFileSync,spawnSync} from "node:child_process";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync,symlinkSync,unlinkSync,linkSync,renameSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {validateEnumManifest,validateEnumFiles} from "../lib/enum-semantics-v1-policy.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const m=JSON.parse(readFileSync(resolve(root,"contracts/enum-semantics-v1.json"),"utf8"));
const mutations=[
 ["duplicate contract rule",x=>{x.cases[1].rule=x.cases[0].rule;}],
 ["duplicate source blob",x=>{x.cases[1].sourceGitBlobSha1=x.cases[0].sourceGitBlobSha1;}],
 ["fabricated confirmed backend",x=>{x.cases[0].confirmedBackends=["java"];}],
 ["fabricated global parity",x=>{x.executableParityCertified=true;}],
 ["unknown backend",x=>{x.cases[0].backends=["java","llvm","wasm","net","phantom"];}],
 ["path traversal",x=>{x.cases[0].file="../escape.ores";}],
 ["case-to-file identity spoof",x=>{x.cases[0].file=x.cases[1].file;}],
 ["duplicate id",x=>{x.cases[1].id=x.cases[0].id;}],
 ["out-of-band case attestation",x=>{x.cases[0].attested=true;}],
 ["out-of-band top-level metadata",x=>{x.attested=true;}],
 ["unexpected diagnostic on success",x=>{x.cases[0].diagnosticCategory="NONE";}],
 ["unexpected output on rejection",x=>{x.cases[3].expectedStdout="1\n";}],
 ["invalid expected stdout",x=>{x.cases[0].expectedStdout="success";}],
 ["missing fixture case",x=>{x.cases.pop();}],
 ["malformed non-boolean certification",x=>{x.executableParityCertified="false";}]
];
for(const [name,mutate] of mutations) {
 test("enum inventory fail-closed mutation: "+name,()=>{
  const copy=structuredClone(m);mutate(copy);
  assert.throws(()=>validateEnumManifest(copy));
 });
}
test("enum inventory detects added, uninventoried fixture",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ores-enum-"));
 try {
  const dest=resolve(dir,"fixtures/enum/v1");mkdirSync(dest,{recursive:true});
  for(const c of m.cases)copyFileSync(resolve(root,"fixtures/enum/v1",c.file),resolve(dest,c.file));
  writeFileSync(resolve(dest,"untracked.ores"),"define enum Fake as Case end\n");
  assert.throws(()=>validateEnumFiles(dir,m));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test("enum inventory rejects forged Git-blob commitment",()=>{
 const copy=structuredClone(m);copy.cases[0].sourceGitBlobSha1="0".repeat(40);
 assert.throws(()=>validateEnumFiles(root,copy));
});

for(const [name,mutate] of [
 ["case unsupported unknown key",x=>{x.cases[0].semanticProof="fake";}],
 ["bad diagnostic category",x=>{x.cases.find(c=>c.expect==="reject").diagnosticCategory="bad";}],
 ["fake backend marker string",x=>{x.cases[0].confirmedBackends="[]";}],
 ["wrong backend roster",x=>{x.cases[0].backends=["llvm","java","net","wasm","forge"];}],
 ["empty semantic rule",x=>{x.cases[0].rule="";}],
 ["invalid fixture path casefold",x=>{x.cases[0].file="Nullary.ores";}],
 ["negative stdout field",x=>{x.cases.find(c=>c.expect==="reject").expectedStdout="1\\n";}],
 ["missing expected output",x=>{delete x.cases[0].expectedStdout;}],
 ["invented execution flag",x=>{x.cases[0].guestExecuted=true;}],
 ["invented backend status",x=>{x.cases[0].backends=["java","llvm","wasm","net","forge","js"];}]
]){
 test("expanded enum host-only manifest mutation: "+name,()=>{
  const copy=structuredClone(m);mutate(copy);
  assert.throws(()=>validateEnumManifest(copy));
 });
}
function withCompleteTempCorpus(run){
 const dir=mkdtempSync(join(tmpdir(),"ores-enum-hard-"));
 try{
  const dest=resolve(dir,"fixtures/enum/v1");mkdirSync(dest,{recursive:true});
  for(const c of m.cases)copyFileSync(resolve(root,"fixtures/enum/v1",c.file),resolve(dest,c.file));
  run(dir,dest);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test("enum fixture symlink cannot impersonate pinned regular file",()=>{
 withCompleteTempCorpus((dir,dest)=>{
  const p=resolve(dest,m.cases[0].file);unlinkSync(p);
  symlinkSync(resolve(root,"fixtures/enum/v1",m.cases[0].file),p);
  assert.throws(()=>validateEnumFiles(dir,m));
 });
});
test("enum fixture hardlink cannot impersonate unique owned fixture",()=>{
 withCompleteTempCorpus((dir,dest)=>{
  const p=resolve(dest,m.cases[0].file);
  linkSync(p,resolve(dir,"outside-fixture-hardlink.bin"));
  assert.throws(()=>validateEnumFiles(dir,m));
 });
});
test("enum fixture invalid UTF-8 is rejected with pinned inventory",()=>{
 withCompleteTempCorpus((dir,dest)=>{
  writeFileSync(resolve(dest,m.cases[0].file),Buffer.from([0xc0,0xaf]));
  assert.throws(()=>validateEnumFiles(dir,m));
 });
});

test("enum fixture directory symlink cannot redirect the corpus",()=>{
 withCompleteTempCorpus((dir,dest)=>{
  const real=resolve(dir,"real-fixtures");
  renameSync(dest,real);
  symlinkSync(real,dest,"dir");
  assert.throws(()=>validateEnumFiles(dir,m),/symlinked fixture directory ancestor/);
 });
});

test("ADT host-only verification driver rejects a mismatched source tree",()=>{
 const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
 const driver=resolve(root,"scripts/verify-adt-conformance-head.sh");
 const run=spawnSync("bash",[driver,head,"0".repeat(40)],{cwd:root,encoding:"utf8",timeout:15000});
 assert.equal(run.status,1);
 assert.match(run.stderr,/ADT_HOST_ONLY_NOT_VERIFIED: source tree mismatch/);
 assert.doesNotMatch(run.stdout,/ADT_HOST_ONLY_PASS=1/);
});
test("ADT host-only verification driver rejects a mismatched source commit",()=>{
 const driver=resolve(root,"scripts/verify-adt-conformance-head.sh");
 const run=spawnSync("bash",[driver,"0".repeat(40),"0".repeat(40)],{cwd:root,encoding:"utf8",timeout:15000});
 assert.equal(run.status,1);
 assert.match(run.stderr,/ADT_HOST_ONLY_NOT_VERIFIED: source HEAD mismatch/);
 assert.doesNotMatch(run.stdout,/ADT_HOST_ONLY_PASS=1/);
});

function withSyntheticAdtHostDriver(suiteBody,check){
 const dir=mkdtempSync(join(tmpdir(),"adt-host-driver-"));
 try {
  mkdirSync(resolve(dir,"scripts"));
  mkdirSync(resolve(dir,"tests"));
  mkdirSync(resolve(dir,"contracts"));
  copyFileSync(resolve(root,"scripts/verify-adt-conformance-head.sh"),
   resolve(dir,"scripts/verify-adt-conformance-head.sh"));
  // A synthetic stand-in deliberately tests the wrapper's TAP admission only.
  // It does not verify actual source worktree integrity or guest semantics.
  writeFileSync(resolve(dir,"scripts/verify-raw-worktree.py"),
   'print("SYNTHETIC_WRAPPER_PROBE_ONLY")\n');
  for(const name of [
   "enum-semantics-v1.test.mjs",
   "enum-semantics-v1-mutations.test.mjs",
   "enum-semantics-v2-six-backend.test.mjs"
  ]) writeFileSync(resolve(dir,"tests",name),suiteBody);
  for(const name of ["enum-semantics-v1.json","enum-semantics-v2.json"])
   writeFileSync(resolve(dir,"contracts",name),"{}\n");
  execFileSync("git",["init","-q"],{cwd:dir});
  execFileSync("git",["add","."],{cwd:dir});
  execFileSync("git",["-c","user.name=synthetic-driver-test",
   "-c","user.email=synthetic@example.invalid","-c","commit.gpgsign=false",
   "commit","-qm","synthetic-only"],{cwd:dir});
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:dir,encoding:"utf8"}).trim();
  const tree=execFileSync("git",["rev-parse","HEAD^{tree}"],{cwd:dir,encoding:"utf8"}).trim();
  const run=spawnSync("bash",["scripts/verify-adt-conformance-head.sh",head,tree],
   {cwd:dir,encoding:"utf8",timeout:20000});
  check(run);
 } finally {rmSync(dir,{recursive:true,force:true});}
}

test("ADT host-only driver rejects 51 intentionally skipped synthetic tests",()=>{
 const skipped='import test from "node:test";\n'+
  Array.from({length:17},(_,i)=>
   'test.skip("synthetic-skipped-'+i+'",()=>{});').join("\n")+"\n";
 withSyntheticAdtHostDriver(skipped,run=>{
  assert.equal(run.status,1,run.stdout+"\n"+run.stderr);
  assert.match(run.stderr,/ADT_HOST_ONLY_NOT_VERIFIED: incomplete, skipped or failed TAP suite/);
  assert.match(run.stdout,/# skipped 51/);
  assert.doesNotMatch(run.stdout,/ADT_HOST_ONLY_PASS=1/);
 });
});

test("ADT host-only driver rejects source-pinned test files with no registered cases",()=>{
 withSyntheticAdtHostDriver("// synthetic test file intentionally registers zero tests\n",run=>{
  assert.equal(run.status,1,run.stdout+"\n"+run.stderr);
  assert.match(run.stderr,/ADT_HOST_ONLY_NOT_VERIFIED: incomplete, skipped or failed TAP suite/);
  assert.doesNotMatch(run.stdout,/ADT_HOST_ONLY_PASS=1/);
 });
});
