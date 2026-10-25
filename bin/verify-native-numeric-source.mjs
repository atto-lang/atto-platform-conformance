#!/usr/bin/env node
// Required real-compiler gate. No implicit skip or simulated guest fallback.
// Imports run within the guarded region: Node's default ESM loader errors
// include absolute repository paths and must never escape to CI logs.
const UNCLASSIFIED="UNCLASSIFIED_EXECUTION_OR_IO_ERROR";
const publicCodes=new Set([
  UNCLASSIFIED,"MISSING_REQUIRED_ARGUMENT","INVALID_CLI_ARGUMENT",
  "INVALID_SOURCE_COMMIT_PIN","INVALID_MANIFEST_PIN","MANIFEST_BYTES_MISMATCH",
  "MANIFEST_SIZE_LIMIT","CORPUS_INVALID","CORPUS_COUNT_DRIFT",
  "LLVM_IR_INVALID","LLVM_GUEST_ABI_INVALID","LLVM_WRAPPER_REWRITE_FAILED",
  "REPORTER_SOURCE_INVALID","NATIVE_EXECUTABLE_PREEXISTS","NATIVE_EXECUTABLE_UNSAFE",
  "COMPILER_DIGEST_MISMATCH","CLANG_DIGEST_MISMATCH"
]);
let safeFailureCode=()=>UNCLASSIFIED;
try{
  const diagnosticModule=await import("../src/native-numeric-safe-diagnostics.mjs");
  safeFailureCode=error=>{
    try{
      const candidate=diagnosticModule.nativeNumericSafeFailureCode?.(error);
      return publicCodes.has(candidate)?candidate:UNCLASSIFIED;
    }catch{return UNCLASSIFIED;}
  };
  const {executeNativeNumericCorpus}=await import("../src/native-numeric-source-evidence.mjs");
  const allowed=new Set(["compiler","compiler-sha256","clang","clang-sha256","clang-resource-dir","source-commit","manifest-sha256"]);
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
  // Filesystem, import-loader and subprocess errors can embed private paths.
  // Emit only fixed, reviewable diagnostic codes to logs and CI artifacts.
  process.stderr.write("NATIVE_EVIDENCE_UNAVAILABLE: "+
    safeFailureCode(error)+"\n");
  process.exitCode=2;
}
