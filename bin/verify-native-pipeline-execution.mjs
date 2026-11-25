#!/usr/bin/env node
/**
 * Verify one actually captured native guest transcript.
 *
 * The trusted runner supplies the exit code and captures stdout/stderr directly
 * from a SHA-pinned compiled executable. These fields remain untrusted if
 * passed by an arbitrary uploader; this CLI is NOT an attestation verifier.
 *
 * argv: guest-stderr-file exit-code [guest-stdout-file]
 */
import {readFile,stat} from "node:fs/promises";
import {verifyNativeGuestSummary, verifyPipelineTrace} from "../src/pipeline-runtime-evidence.mjs";

const PREFIX="SOURCE_PIPELINE_TRACE_JSON ";
const FIXTURE_BLOB="46579a917516899612fcd8c65c70b24b995c2c5a";
const rejected=message=>{throw new Error(message)};
async function boundedFile(path, limit) {
 const info=await stat(path);
 if(!info.isFile()||info.size>limit)rejected("evidence exceeds strict file size or type bound");
 return readFile(path,"utf8");
}
export function verifyNativeTranscript(stderr, exitCode, stdout="") {
 if(typeof stderr!=="string"||stderr.length>131072)rejected("invalid native transcript");
 if(exitCode!==43||stdout!=="")rejected("unexpected compiled guest process status or output");
 const lines=stderr.split(/\r?\n/);
 const traces=lines.filter(line=>line.startsWith(PREFIX));
 if(traces.length!==1)rejected("expected exactly one runtime-owned trace envelope");
 if(traces[0].length>32768)rejected("oversized runtime trace envelope");
 let trace;
 try{trace=JSON.parse(traces[0].slice(PREFIX.length))}
 catch{rejected("malformed native trace JSON")}
 const verdict=verifyPipelineTrace(trace);
 if(!verdict.ok)rejected("invalid runtime transitions: "+verdict.errors.join("; "));
 if(trace.backend!=="llvm-native"||trace.sourceGitBlobSha1!==FIXTURE_BLOB)
  rejected("trace does not bind the compiled source fixture");
 if(trace.events.length!==22||verdict.forwardAdmissions!==2||
    verdict.backwardAdmissions!==2||verdict.completions!==1||verdict.restarts!==0)
  rejected("noncanonical bounded compiled guest transitions");
 if(trace.events.at(-1).op!=="stop"||trace.events.at(-2).op!=="complete")
  rejected("runtime trace missing terminal completion and STOP sequence");
 const summary=verifyNativeGuestSummary({
  backend:"llvm-native",sourceGitBlobSha1:FIXTURE_BLOB,
  exitCode,stdout,stderr
 });
 if(!summary.ok)rejected("compiled guest physical receipts invalid: "+summary.errors.join("; "));
 // The native trace is written after group teardown: event record precedes
 // output, but its dump must follow actual physical group quiescence.
 const group=lines.findIndex(l=>l.startsWith("SOURCE_ACTOR_GROUP_VERIFIED"));
 const dump=lines.findIndex(l=>l.startsWith(PREFIX));
 if(group<0||dump<=group)rejected("trace dumped before physical group termination");
 return {ok:true,backend:trace.backend,events:trace.events.length,
   forward:verdict.forwardAdmissions,backward:verdict.backwardAdmissions,
   completed:verdict.completions,physicalStops:3,groupClosed:true};
}
const invoked=process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href;
if(invoked){
 try{
  const [stderrPath,rawCode,stdoutPath,...more]=process.argv.slice(2);
  if(!stderrPath||!rawCode||more.length||!/^(0|[1-9][0-9]{0,2})$/.test(rawCode))
   rejected("usage: verify-native-pipeline-execution.mjs stderr-file exit-code [stdout-file]");
  const stdout=stdoutPath?await boundedFile(stdoutPath,8192):"";
  const stderr=await boundedFile(stderrPath,131072);
  console.log(JSON.stringify(verifyNativeTranscript(stderr,Number(rawCode),stdout)));
 }catch(e){
  console.error("native pipeline verification failed:",e.message);
  process.exitCode=1;
 }
}
