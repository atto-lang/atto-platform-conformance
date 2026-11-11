#!/usr/bin/env node
// Fail closed unless a configured compiler has both compiled AND executed the
// canonical guest fixture. This runner is not an independent provenance attestor.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";

const fixtureRoot=fileURLToPath(new URL("../contracts/value-pipe-tuples/v1/", import.meta.url));
const plan=JSON.parse(fs.readFileSync(path.join(fixtureRoot,"runner-contract.json"),"utf8"));
const required=(key)=>{
  const v=process.env[key];
  if(!v?.trim())throw Error(key+" is required: no missing-tool or source-only PASS");
  return v.trim();
};
const cmd=(key)=>{
  const val=JSON.parse(required(key));
  if(!Array.isArray(val)||!val.length
      ||val.some(x=>typeof x!=="string"||!x.trim())
      ||val[0].includes("{fixture}")
      ||val.filter(x=>x==="{fixture}").length!==1
      ||val.some((x,i)=>i>0&&x.includes("{fixture}")&&x!=="{fixture}"))
    throw Error(key+" must be nonempty no-shell JSON argv with exactly one standalone {fixture}");
  return val;
};
const run=cmd("ATTO_TUPLE_RUN_ARGV_JSON");
const check=cmd("ATTO_TUPLE_CHECK_ARGV_JSON");
const backend=required("ATTO_TUPLE_BACKEND"),compiler=required("ATTO_TUPLE_COMPILER_ID");
if(!plan.target_backends.includes(backend))throw Error("unlisted backend: "+backend);
const cwd=fs.realpathSync(required("ATTO_TUPLE_WORKDIR"));
if(!fs.statSync(cwd).isDirectory())throw Error("workdir must be a directory");

// No PATH lookup, implicit interpreter or shell: pin the actual launch program
// for BOTH compile-check and guest execution. An ABI-producing compiler may
// spawn an independent guest binary, which needs separate external provenance.
function executable(name){
  const full=fs.realpathSync(path.isAbsolute(name)?name:path.resolve(cwd,name));
  if(!fs.statSync(full).isFile())throw Error("not a regular executable file: "+name);
  return full;
}
const compilerBinary=executable(required("ATTO_TUPLE_COMPILER_BINARY"));
const checkProgram=executable(check[0]),runProgram=executable(run[0]);
if(checkProgram!==compilerBinary)
  throw Error("compile-check argv[0] must be the pinned ATTO_TUPLE_COMPILER_BINARY");
const sha256=(filename)=>createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const compilerSha=sha256(compilerBinary),runSha=sha256(runProgram);
const blobSha=(data)=>createHash("sha1").update(Buffer.concat([
  Buffer.from("blob "+data.length+String.fromCharCode(0)),data])).digest("hex");

function verifyFixture(item){
  if(typeof item.path!=="string"||!item.path.endsWith(".atto"))
    throw Error("invalid fixture path");
  const full=path.resolve(fixtureRoot,item.path);
  const relative=path.relative(fixtureRoot,full);
  if(!relative||relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative))
    throw Error("fixture escapes root");
  const canonicalRoot=fs.realpathSync(fixtureRoot),canonicalFile=fs.realpathSync(full);
  if(!canonicalFile.startsWith(canonicalRoot+path.sep))
    throw Error("symlinked fixture escapes canonical root");
  const bytes=fs.readFileSync(canonicalFile);
  if(blobSha(bytes)!==item.git_blob_sha1)
    throw Error("source fixture Git blob mismatch: "+item.path);
  return canonicalFile;
}
function invoke(argv,file){
  const expanded=argv.map(x=>x==="{fixture}"?file:x);
  const result=spawnSync(executable(expanded[0]),expanded.slice(1),{
    cwd,encoding:"utf8",shell:false,timeout:180000,maxBuffer:1048576
  });
  if(result.error)throw result.error;
  return {status:result.status,signal:result.signal,
          stdout:result.stdout||"",stderr:result.stderr||""};
}
const positiveFile=verifyFixture(plan.positive);
// If the compile-only checker rejects the *positive* tuple source, there is no
// valid evidence, even when an unrelated process can print the expected stdout.
const admitted=invoke(check,positiveFile);
if(admitted.status!==0||admitted.signal||admitted.stdout===plan.positive.stdout)
  throw Error("positive tuple source failed compile-only admission or check ran guest: "+JSON.stringify(admitted));
const positive=invoke(run,positiveFile);
if(positive.status!==0||positive.stdout!==plan.positive.stdout||positive.signal)
  throw Error("positive guest output/exit mismatch "+JSON.stringify(positive));
const negatives=[];
for(const item of plan.negative){
  const full=verifyFixture(item),res=invoke(check,full);
  const diagnostic=(res.stdout+"\n"+res.stderr).replaceAll(full,"<fixture>");
  if(!Number.isInteger(res.status)||res.status<=0||res.signal
      ||!new RegExp(item.diagnostic_family,"i").test(diagnostic))
    throw Error("negative source not soundly rejected: "+item.path+" "+JSON.stringify(res));
  negatives.push({fixture:item.path,status:res.status,diagnostic_family_matched:true});
}
// A user-supplied command or GITHUB_RUN_ID cannot independently prove the
// compiler's source tree, actual native guest code or Actions runner steps.
process.stdout.write(JSON.stringify({
  schema:"atto.tuple-guest-evidence/v1",backend,compiler,
  binary_sha256:compilerSha,run_program_sha256:runSha,
  compile_check_executable:checkProgram,guest_run_executable:runProgram,
  positive_compile_admission:true,positive_fixture:plan.positive.git_blob_sha1,
  positive_stdout:positive.stdout,negative_checks:negatives,
  github_run_id:process.env.GITHUB_RUN_ID||null,
  github_run_attempt:process.env.GITHUB_RUN_ATTEMPT||null,
  real_executable_invoked:true,
  scope:"configured compiler admission + guest output only; independent source-tree, AOT artifact and CI step attestation still required"
},null,2)+"\n");
