import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,symlinkSync,linkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {SCHEMA,SOURCE,SOURCE_BLOB,SOURCE_SHA256,EXPECTED} from
  "../src/actor-ml-five-toolchain-evidence.mjs";

const executable=fileURLToPath(new URL("../bin/check-actor-ml-five-toolchain-evidence.mjs",import.meta.url));
const head="abcdef0123456789abcdef0123456789abcdef01";
const digest="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const valid=()=>({
  schema:SCHEMA,fixture:{source:SOURCE,git_blob:SOURCE_BLOB,sha256:SOURCE_SHA256,expected:"42"},
  backends:Object.entries(EXPECTED).map(([backend,p],i)=>({
    backend,repository:"ores-truffle-oreslang/oreslang-source."+backend,
    profile:p.profile,source_commit:head,source_tree:head,
    source_blob:SOURCE_BLOB,source_sha256:SOURCE_SHA256,
    compiler_sha256:digest,guest_sha256:digest,
    compile:{argv:["/tmp/compiler"],exit_code:0,signal:null,timed_out:false,truncated:false},
    execution:{argv:["/tmp/guest"],status:p.status,probe:p.probe,value:"42",
      guest_executed:true,signal:null,timed_out:false,truncated:false},
    ci:{run_id:100+i,job_id:200+i,runner_id:300+i,steps_executed:7,
      head_sha:head,conclusion:"success"}
  }))
});
const run=(path,structural=false)=>spawnSync(process.execPath,
  [executable,path,...(structural?["--structural-only"]:[])],
  {encoding:"utf8",timeout:15000,maxBuffer:256*1024});

test("valid synthetic records never promote guest parity without explicit structural-only flag",()=>{
  const dir=mkdtempSync(join(tmpdir(),"actor-ml-receipt-"));
  try {
    const file=join(dir,"receipt.json");
    writeFileSync(file,JSON.stringify(valid()));
    const normal=run(file);
    assert.equal(normal.status,3,normal.stderr);
    const parsed=JSON.parse(normal.stdout);
    assert.equal(parsed.five_toolchain_parity_certified,false);
    assert.equal(parsed.real_guest_authenticated,false);
    const structural=run(file,true);
    assert.equal(structural.status,0,structural.stderr);
    assert.equal(JSON.parse(structural.stdout).runner_authenticated,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("zero-step or forged certification is rejected before structural-only success",()=>{
  const dir=mkdtempSync(join(tmpdir(),"actor-ml-deny-"));
  try {
    const file=join(dir,"receipt.json");
    const bad=valid();bad.backends[0].ci.steps_executed=0;
    writeFileSync(file,JSON.stringify(bad));
    assert.equal(run(file,true).status,1);
    const forged=valid();forged.five_toolchain_parity_certified=true;
    writeFileSync(file,JSON.stringify(forged));
    assert.equal(run(file,true).status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("unsupported report forms and absent path fail closed",()=>{
  assert.equal(run("/nonexistent/actor-ml-parity-report.json").status,1);
  const dir=mkdtempSync(join(tmpdir(),"actor-ml-file-"));
  try {
    const file=join(dir,"receipt.json");
    writeFileSync(file,"x".repeat(128*1024+1));
    assert.equal(run(file).status,1);
    if(process.platform!=="win32"){
      const real=join(dir,"real.json");
      const alias=join(dir,"alias.json");
      writeFileSync(real,JSON.stringify(valid()));
      symlinkSync(real,alias);
      assert.equal(run(alias,true).status,1);
      const hard=join(dir,"hardlink.json");
      linkSync(real,hard);
      assert.equal(run(real,true).status,1);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
