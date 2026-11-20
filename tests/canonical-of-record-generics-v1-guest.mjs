// Explicit opt-in: ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<40 hex chars>
// Native compiler -> real Wasm guests only. Never use JS implementations as oracles.
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync} from "node:fs";
import {resolve, join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const reg=JSON.parse(readFileSync(join(root,"contracts/canonical-of-record-generics-v1.json"),"utf8"));
const bin=process.env.ATTOC_BIN;
const sha=process.env.ATTO_SOURCE_SHA;
assert.ok(bin && bin.startsWith("/"),"Require absolute ATTOC_BIN compiler path");
assert.match(sha||"",/^[0-9a-f]{40}$/,"Require exact compiler SHA; no unpinned runs");
assert.ok(existsSync(bin),"Compiler binary does not exist");
const temp=mkdtempSync(join(tmpdir(),"atto-of-guest-"));
const outcomes=[];
try {
  for(const c of reg.cases) {
    const src=readFileSync(join(root,c.fixture),"utf8");
    const input=join(temp,c.id+".atto"),out=join(temp,c.id+".wasm");
    writeFileSync(input,src);
    const r=spawnSync(bin,[input,"-o",out],{encoding:"utf8",timeout:30000,maxBuffer:1048576});
    const errors=((r.stderr||"")+"\n"+(r.stdout||""));
    const diag=errors.match(/E_[A-Z0-9_]+/)?.[0]||null;
    const result={id:c.id,status:"failed",diagnostic:diag,guest_executed:false,reason:""};
    if(r.error) result.reason="compiler_failed:"+r.error.message;
    else if(c.expect==="reject") {
      if(r.status!==0 && !existsSync(out) && diag===c.expected_error){
        result.status="passed"; result.reason="expected_reject_no_artifact";
      } else if(diag==="E_UNSUPPORTED") {result.status="unsupported";result.reason="frontend_not_implemented";}
      else result.reason="unexpected_accept_or_diagnostic_or_artifact";
    } else if(r.status===0 && existsSync(out)) {
      try {
        const bytes=readFileSync(out);
        assert.ok(WebAssembly.validate(bytes),"invalid emitted guest Wasm");
        const mod=new WebAssembly.Module(bytes);
        const imports=WebAssembly.Module.imports(mod);
        assert.ok(imports.every(i=>i.module==="atto" && i.name==="print_i64"),"unexpected or ambient host imports");
        const inst=new WebAssembly.Instance(mod,{atto:{print_i64(){}}});
        assert.equal(typeof inst.exports.main,"function");
        assert.equal(BigInt(inst.exports.main()),BigInt(c.expected_exit),"wrong guest return");
        if(inst.exports.panic_code) assert.equal(Number(inst.exports.panic_code.value),0);
        result.status="passed";result.guest_executed=true;result.reason="real_compiled_guest";
      } catch(e){result.reason="guest_error:"+String(e.message||e);}
    } else if(diag==="E_UNSUPPORTED"||diag==="E_UNSUPPORTED_TYPE"){
      result.status="unsupported";result.reason="missing_verified_guest_lowering";
    } else result.reason="compiler_rejected_expected_guest_or_failed_to_emit";
    outcomes.push(result);
  }
} finally {rmSync(temp,{recursive:true,force:true});}
const receipt={schema_version:1,contract:reg.contract,backend:"rs-native-to-wasm",compiler_sha:sha,compiled_guest:true,
  results:outcomes,counts:Object.fromEntries(["passed","failed","unsupported"].map(s=>[s,outcomes.filter(o=>o.status===s).length]))};
if(process.env.ATTO_RECEIPT_PATH) writeFileSync(process.env.ATTO_RECEIPT_PATH,JSON.stringify(receipt,null,2)+"\n");
console.log("ATTO_CANONICAL_OF_GUEST_RECEIPT="+JSON.stringify(receipt));
if(outcomes.some(o=>o.status!=="passed")) process.exitCode=1;
