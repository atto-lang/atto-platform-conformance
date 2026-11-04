#!/usr/bin/env node
// This CLI intentionally NEVER grants parity certification. It only checks
// a bounded report's structure and returns nonzero unless explicitly asked
// for a structural-only result.
import {open, lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve} from "node:path";
import {inspectActorMlFiveToolchainEvidence} from "../src/actor-ml-five-toolchain-evidence.mjs";

const requested = process.argv[2];
const structuralOnly = process.argv[3] === "--structural-only";
if (![3,4].includes(process.argv.length) || !requested ||
    (process.argv.length === 4 && !structuralOnly)) {
  console.error("usage: node bin/check-actor-ml-five-toolchain-evidence.mjs REPORT.json [--structural-only]");
  process.exit(2);
}
let fd;
try {
  if (!Number.isInteger(constants.O_NOFOLLOW))
    throw Error("O_NOFOLLOW unavailable; evidence admission must fail closed");
  const path=resolve(requested);
  const lst=await lstat(path);
  if (!lst.isFile() || lst.isSymbolicLink() || lst.nlink!==1 ||
      lst.size===0 || lst.size>128*1024)
    throw Error("report must be bounded, regular, unlinked and nonempty");
  fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=await fd.stat();
  if (!before.isFile() || before.nlink!==1 || before.size!==lst.size ||
      before.ino!==lst.ino || before.dev!==lst.dev)
    throw Error("evidence report changed during admission");
  const input=Buffer.alloc(128*1024+1);
  let bytes=0;
  while(bytes<input.length) {
    const result=await fd.read(input,bytes,input.length-bytes,bytes);
    if(result.bytesRead===0)break;
    bytes+=result.bytesRead;
  }
  if(bytes>128*1024) throw Error("report exceeded byte budget");
  const after=await fd.stat();
  if(after.size!==before.size || after.mtimeMs!==before.mtimeMs ||
      after.ctimeMs!==before.ctimeMs || after.nlink!==1 || bytes!==before.size)
    throw Error("report changed during read");
  const report=JSON.parse(input.subarray(0,bytes).toString("utf8"));
  const result=inspectActorMlFiveToolchainEvidence(report);
  console.log(JSON.stringify(result,null,2));
  if(!structuralOnly)process.exitCode=3; // no parity certification possible
} catch(error) {
  console.error("actor-ml evidence refused: "+error.message);
  process.exitCode=1;
} finally {
  if(fd)await fd.close();
}
