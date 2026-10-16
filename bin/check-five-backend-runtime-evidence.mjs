#!/usr/bin/env node
import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {validateFiveBackendRuntimeEvidence} from '../src/five-backend-runtime-evidence.mjs';

const path = process.argv[2];
const structuralOnly = process.argv[3] === '--structural-only';
if (![3,4].includes(process.argv.length) || !path ||
    (process.argv.length === 4 && !structuralOnly)) {
  console.error('usage: node bin/check-five-backend-runtime-evidence.mjs REPORT.json [--structural-only]');
  process.exit(2);
}
let fd;
try {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw Error('O_NOFOLLOW unsupported');
  const absolute=resolve(path);
  const lst=await lstat(absolute);
  if (!lst.isFile() || lst.isSymbolicLink() || lst.nlink !== 1 || lst.size > 128 * 1024)
    throw Error('report must be a small ordinary unlinked regular file');
  fd=await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const s=await fd.stat();
  if (!s.isFile() || s.nlink !== 1 || s.size > 128 * 1024 ||
    s.dev !== lst.dev || s.ino !== lst.ino) throw Error('report file changed during open');
  const bytes=await fd.readFile();
  if (bytes.length > 128 * 1024) throw Error('report too large');
  const result=validateFiveBackendRuntimeEvidence(JSON.parse(bytes.toString('utf8')));
  console.log(JSON.stringify(result,null,2));
  // Nonzero by default: no unverified report can become a green parity gate.
  // Zero exit is opt-in for structural validation ONLY.
  if (!structuralOnly) process.exitCode = 3;
} catch (error) {
  console.error('five-backend evidence rejected: ' + error.message);
  process.exitCode=1;
} finally {
  if(fd) await fd.close();
}
