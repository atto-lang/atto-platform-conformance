#!/usr/bin/env node
// Required real-compiler gate. No implicit skip or simulated guest fallback.
import {executeNativeNumericCorpus} from "../src/native-numeric-source-evidence.mjs";
import {nativeNumericSafeFailureCode} from "../src/native-numeric-safe-diagnostics.mjs";
const allowed=new Set(["compiler","compiler-sha256","clang","clang-sha256","clang-resource-dir","source-commit","manifest-sha256"]);
try{
  const args={};
  for(const arg of process.argv.slice(2)){
    const match=/^--([a-z][a-z0-9-]*)=(.+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||Object.hasOwn(args,match[1]))
      throw Error("unexpected/duplicate argument");
    args[match[1]]=match[2];
  }
  for(const key of allowed)if(!args[key])throw Error("missing --"+key);
  const evidence=await executeNativeNumericCorpus({
    compiler:args.compiler,compilerSha256:args["compiler-sha256"],
    clang:args.clang,clangSha256:args["clang-sha256"],
    clangResourceDir:args["clang-resource-dir"],
    sourceCommit:args["source-commit"],manifestSha256:args["manifest-sha256"]
  });
  process.stdout.write(JSON.stringify(evidence,null,2)+"\n");
  if(!evidence.ok)process.exitCode=1;
}catch(error){
  // Filesystem and subprocess errors often embed private absolute paths.
  // Emit only fixed, reviewable diagnostic codes to logs and CI artifacts.
  process.stderr.write("NATIVE_EVIDENCE_UNAVAILABLE: "+
    nativeNumericSafeFailureCode(error)+"\n");
  process.exitCode=2;
}
