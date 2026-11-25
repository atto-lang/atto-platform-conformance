#!/usr/bin/env node
// Source-free offline verifier. An internally consistent receipt is NOT
// independently attested compiler/guest execution or source-transfer approval.
import {openSync,closeSync,fstatSync,readSync,constants,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const hex40 = x => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x);
const hex64 = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const id = x => Number.isSafeInteger(x) && x > 0;
const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const result = (classification, reason, extras={}) => ({classification,reason,independentlyAttested:false,portable:false,privateSourceExportAuthorized:false,...extras});
const bad = reason => result('UNVERIFIED',reason);

export function verifyUserlandReceipt(r,c) {
  if (!obj(c) || c.schemaVersion!==1 || c.contract!=='oreslang.userland-portability/1' ||
      c.fixtureRepository!=='ores-truffle-oreslang/oreslang-proof-of-concepts' || !hex40(c.fixtureCommitSha) ||
      !obj(c.profiles) || !Array.isArray(c.fixtures) || c.fixtures.length===0)
    return bad('invalid contract');
  if (!obj(r) || r.schemaVersion!==1 || r.contract!==c.contract ||
      !Object.hasOwn(c.profiles,r.profile) || r.compilerRepository!==c.profiles[r.profile] ||
      r.fixtureRepository!==c.fixtureRepository || r.fixtureCommitSha!==c.fixtureCommitSha ||
      !hex40(r.fixtureTreeSha) || !hex40(r.compilerCommitSha) || !hex40(r.compilerTreeSha) ||
      !hex64(r.compilerBinarySha256) || !hex64(r.guestArtifactSha256))
    return bad('missing or substituted compiler, fixture or artifact identity');
  const run=r.run;
  if (!obj(run) || run.repository!==r.fixtureRepository || run.headSha!==r.fixtureCommitSha ||
      !id(run.id) || !id(run.attempt) || run.status!=='completed' || run.conclusion!=='success' ||
      !Array.isArray(run.jobs) || run.jobs.length!==1)
    return bad('incomplete or unsuccessful exact-head workflow');
  const job=run.jobs[0];
  if (!obj(job) || !id(job.id) || !id(job.runnerId) || job.runId!==run.id ||
      job.attempt!==run.attempt || job.headSha!==run.headSha ||
      job.status!=='completed' || job.conclusion!=='success' ||
      !Array.isArray(job.steps) || job.steps.length<3 ||
      !job.steps.every(s=>obj(s) && typeof s.name==='string' && s.status==='completed' && s.conclusion==='success') ||
      new Set(job.steps.map(s=>s.name)).size!==job.steps.length ||
      !['Checkout exact Oreslang sources','Compile Oreslang guest','Execute Oreslang guest'].every(x=>job.steps.some(s=>s.name===x)))
    return bad('missing actual assigned runner, bound job or required executed steps');
  if (!Array.isArray(r.cases) || r.cases.length!==c.fixtures.length ||
      !c.fixtures.every(f=>obj(f) && /^[a-z0-9-]+$/.test(f.id) &&
        typeof f.sourcePath==='string' && typeof f.oraclePath==='string' &&
        hex40(f.sourceBlobSha) && hex40(f.oracleBlobSha) &&
        typeof f.stdout==='string' && f.stdout.endsWith('\n')) ||
      new Set(c.fixtures.map(f=>f.id)).size!==c.fixtures.length)
    return bad('incomplete cases or malformed fixture contract');
  const expected=new Map(c.fixtures.map(f=>[f.id,f]));
  const seen=new Set();
  for (const x of r.cases) {
    if (!obj(x) || !expected.has(x.id) || seen.has(x.id)) return bad('unknown or duplicate userland case');
    seen.add(x.id);
    const f=expected.get(x.id);
    if (x.sourceBlobSha!==f.sourceBlobSha || x.oracleBlobSha!==f.oracleBlobSha ||
        x.executionKind!=='compiled-ores-guest' || x.exitCode!==0 ||
        x.stdout!==f.stdout || !hex64(x.guestBinarySha256) ||
        !id(x.jobId) || x.jobId!==job.id)
      return bad('wrong fixture hash, execution kind, guest identity or exact stdout');
  }
  if (seen.size!==expected.size) return bad('partial userland library coverage');
  return result('RECEIPT_METADATA_CONSISTENT',
    'self-reported metadata only; independently verify raw run/job logs, immutable Git objects, compiler provenance and guest execution',
    {profile:r.profile, candidateCases:seen.size, requiredCases:expected.size});
}

// User-selected evidence files are untrusted and must not be FIFOs, symlinks
// or unbounded. No network or GitHub calls occur in this verifier.
export function readBoundedJson(path) {
  if (typeof path!=='string' || !path) throw Error('JSON path required');
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK))
    throw Error('safe file flags unavailable');
  const max=256*1024;
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=fstatSync(fd);
    if (!stat.isFile() || stat.size<1 || stat.size>max) throw Error('invalid regular JSON file size');
    const bytes=Buffer.alloc(max+1);
    let n=0;
    while(n<bytes.length) { const read=readSync(fd,bytes,n,bytes.length-n,null);if(!read)break;n+=read; }
    if (n<1 || n>max) throw Error('JSON size budget exceeded');
    return JSON.parse(bytes.toString('utf8',0,n));
  } finally {closeSync(fd);}
}

if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    if(process.argv.length!==3)throw Error('usage: node tools/verify-userland-portability.mjs receipt.json');
    const contract=JSON.parse(readFileSync(fileURLToPath(new URL('../contracts/userland-portability-v1.json',import.meta.url)),'utf8'));
    const verdict=verifyUserlandReceipt(readBoundedJson(process.argv[2]),contract);
    console.log(JSON.stringify(verdict));
    // Nonzero even for an internally consistent receipt: a self-reported JSON
    // bundle must never accidentally turn a required release check green.
    process.exitCode=verdict.classification==='RECEIPT_METADATA_CONSISTENT'?3:1;
  } catch {console.error('UNVERIFIED: invalid or inaccessible userland evidence');process.exitCode=2;}
}
