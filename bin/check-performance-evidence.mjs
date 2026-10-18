#!/usr/bin/env node
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {validatePerformanceEvidence} from '../src/performance-evidence.mjs';

const path=process.argv[2];
const structuralOnly=process.argv[3] === '--structural-only';
if (!path || ![3,4].includes(process.argv.length) ||
    (process.argv.length === 4 && !structuralOnly)) {
  console.error('usage: node bin/check-performance-evidence.mjs REPORT.json [--structural-only]');
  process.exit(2);
}
let fd;
try {
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK))
    throw Error('safe no-follow file reads unsupported');
  const filename=resolve(path), lst=await lstat(filename);
  const limit=128*1024;
  if(!lst.isFile() || lst.isSymbolicLink() || lst.nlink !== 1 || lst.size > limit)
    throw Error('expected bounded ordinary file with no hardlinks/symlinks');
  fd=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=await fd.stat();
  if(!before.isFile() || before.nlink !== 1 || before.dev !== lst.dev ||
     before.ino !== lst.ino || before.size > limit) throw Error('input changed during open');
  const buf=Buffer.alloc(limit+1);
  let used=0;
  while(used<buf.length){
    const {bytesRead}=await fd.read(buf,used,buf.length-used,used);
    if(!bytesRead)break;
    used+=bytesRead;
  }
  if(used>limit)throw Error('report too large');
  const after=await fd.stat();
  if(after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
     after.ctimeMs !== before.ctimeMs || used !== before.size)
    throw Error('input mutated while reading');
  const result=validatePerformanceEvidence(JSON.parse(buf.subarray(0,used).toString('utf8')));
  console.log(JSON.stringify(result,null,2));
  // A schema check must not accidentally become a release-performance green gate.
  if (!structuralOnly) process.exitCode=3;
} catch(error){
  console.error('performance evidence rejected: ' + error.message);
  process.exitCode=1;
} finally { if(fd)await fd.close(); }
