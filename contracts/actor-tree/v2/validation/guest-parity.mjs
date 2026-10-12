#!/usr/bin/env node
// Fail-closed evidence gate, NOT a replacement for executable compiler/runtime CI.
// The CI job must build the exact source and run two real backends. The guest
// cannot write the reserved host-owned audit FD; the trusted host does.
import {readFileSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRoundTrip, identityKey, NORMATIVE_SCHEMA_SHA256} from './verify-roundtrip.mjs';

export const BACKENDS = ['llvm-native', 'java-graalvm'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(ROOT, 'guest/manifest.json');
const SCHEMA = resolve(ROOT, 'schemas/typed-pipeline-roundtrip.schema.json');
const REPO = resolve(ROOT, '../../..');
const CLOSED_EVIDENCE = ['kind', 'backend', 'sourceGitBlobSha1', 'trace', 'physicalDone'];
const CLOSED_DONE = ['actor', 'done', 'cleanupDrained'];

function closed(o, fields) {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      Reflect.ownKeys(o).length !== fields.length ||
      fields.some(k => !Object.hasOwn(o, k)) ||
      Reflect.ownKeys(o).some(k => !fields.includes(k))) {
    throw new Error('noncanonical evidence object');
  }
}
function fileBytes(path, maxBytes=1024*1024) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error('source/authority file size or type invalid');
  }
  return readFileSync(path);
}
export function parseCanonicalAudit(bytes) {
  if (!bytes || bytes.length > 262144 || bytes.length < 3) {
    throw new Error('one bounded host audit record required on fd 3');
  }
  const s=bytes.toString('utf8');
  // Every backend writes exactly one compact JSON object and terminal newline.
  // Roundtrip equality rejects duplicate JSON keys and ambiguous encodings.
  if (!s.endsWith('\n') || s.endsWith('\n\n')) throw new Error('noncanonical audit framing');
  const value=JSON.parse(s.slice(0,-1));
  if (JSON.stringify(value)+'\n' !== s) throw new Error('noncanonical or duplicate-key audit JSON');
  return value;
}
export function gitBlobSha1(bytes) {
  return createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
}
export function loadManifest(path=MANIFEST) {
  const manifest=JSON.parse(fileBytes(path).toString('utf8'));
  closed(manifest, ['kind','profile','sourcePath','sourceGitBlobSha1','schemaHash','expectedValues','expectedExitCode']);
  if (manifest.kind!=='oreslang-v2-guest-certification' || manifest.profile!=='signed-i64-boundaries' ||
      !/^[0-9a-f]{40}$/.test(manifest.sourceGitBlobSha1) ||
      manifest.schemaHash!==NORMATIVE_SCHEMA_SHA256 ||
      manifest.expectedExitCode!==43 ||
      JSON.stringify(manifest.expectedValues)!==JSON.stringify([
        '-9223372036854775808','-9223372036854775808',
        '9223372036854775807','9223372036854775807'])) {
    throw new Error('unsupported or modified certification manifest');
  }
  // Manifest path is an allowlisted relative file, not a runtime caller path.
  if (manifest.sourcePath!=='contracts/actor-tree/v2/guest/three-actor-signed-i64.ores') {
    throw new Error('unexpected guest source path');
  }
  const source=resolve(REPO, manifest.sourcePath);
  if (gitBlobSha1(fileBytes(source))!==manifest.sourceGitBlobSha1) {
    throw new Error('guest source Git blob identity mismatch');
  }
  if (createHash('sha256').update(fileBytes(SCHEMA)).digest('hex')!==manifest.schemaHash) {
    throw new Error('normative JSON Schema digest changed');
  }
  return {manifest, source};
}
export function verifyCapture(evidence, backend, manifest, authority) {
  closed(evidence, CLOSED_EVIDENCE);
  if (!BACKENDS.includes(backend) || evidence.kind!=='oreslang-v2-guest-audit' ||
      evidence.backend!==backend || evidence.sourceGitBlobSha1!==manifest.sourceGitBlobSha1) {
    throw new Error('wrong runtime, guest identity or audit kind');
  }
  // Authority MUST be provisioned separately by the trusted host before
  // executing the guest; deriving it from evidence.trace is forbidden.
  if (!authority || authority.expectedSchemaHash!==manifest.schemaHash) {
    throw new Error('independent trusted authority required');
  }
  const checked = verifyRoundTrip(evidence.trace, authority);
  if (checked.values.map(String).join(',')!==manifest.expectedValues.join(',')) {
    throw new Error('wrong signed-i64 guest result');
  }
  if (!Array.isArray(evidence.physicalDone) || evidence.physicalDone.length!==3) {
    throw new Error('missing three physical DONE receipts');
  }
  const expected=authority.expectedRoute.map(identityKey);
  const seen=new Set();
  for (const receipt of evidence.physicalDone) {
    closed(receipt, CLOSED_DONE);
    const key=identityKey(receipt.actor);
    if (!expected.includes(key) || seen.has(key) || receipt.done!==true ||
        receipt.cleanupDrained!==true) {
      throw new Error('stale, duplicate or incomplete physical DONE receipt');
    }
    seen.add(key);
  }
  // Normalize only runtime-generated identifiers, never route, direction or value.
  return evidence.trace.messages.map((m,i)=>({
    hopIndex:i, direction:m.direction, from:expected.indexOf(identityKey(m.from)),
    to:expected.indexOf(identityKey(m.to)), variant:m.payload.variant,
    i64Decimal:m.payload.i64Decimal, schemaHash:m.schemaHash
  }));
}
export function compareCaptures(llvm, graal, manifest, llvmAuthority, graalAuthority) {
  const a=verifyCapture(llvm, BACKENDS[0], manifest, llvmAuthority);
  const b=verifyCapture(graal, BACKENDS[1], manifest, graalAuthority);
  if (JSON.stringify(a)!==JSON.stringify(b)) {
    throw new Error('real LLVM and GraalVM guest traces disagree');
  }
  return {status:'verified', actors:3, forward:2, backward:2,
    values:manifest.expectedValues, sourceGitBlobSha1:manifest.sourceGitBlobSha1};
}
// Defense in depth: never forward the full CI process environment to a
// compiled guest runner. In particular, exclude tokens, SSH agent sockets,
// cloud credentials, GitHub secrets, and user home/config paths. This is an
// environment boundary only, NOT operating-system or FD3 isolation.
const RUNNER_ENV_ALLOWLIST = Object.freeze([
  'PATH', 'LANG', 'LC_ALL', 'JAVA_HOME', 'GRAALVM_HOME',
  'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'TMPDIR'
]);
export function guestRunnerEnvironment(hostEnv, backend, manifest, source) {
  if (!BACKENDS.includes(backend) || !manifest ||
      !/^[a-f0-9]{40}$/.test(manifest.sourceGitBlobSha1) ||
      typeof source !== 'string' || !source.length) {
    throw new Error('invalid guest runner environment authority');
  }
  const env=Object.create(null);
  for (const key of RUNNER_ENV_ALLOWLIST) {
    if (typeof hostEnv?.[key] === 'string' && hostEnv[key].length) {
      env[key]=hostEnv[key];
    }
  }
  env.ORESLANG_GUEST_SOURCE=source;
  env.ORESLANG_GUEST_SOURCE_GIT_BLOB=manifest.sourceGitBlobSha1;
  env.ORESLANG_GUEST_AUDIT_FD='3';
  env.ORESLANG_GUEST_BACKEND=backend;
  return env;
}
function runBackend(executable, backend, manifest, source) {
  const out=spawnSync(executable, [], {
    env:guestRunnerEnvironment(process.env, backend, manifest, source),
    stdio:['ignore','pipe','pipe','pipe'], maxBuffer:1024*1024,
    timeout:180000, encoding:'buffer'
  });
  if (out.error || out.signal || out.status!==manifest.expectedExitCode) {
    throw new Error(backend+' guest runner did not terminate with required exit code 43: '+
      (out.error?.message ?? out.signal ?? out.status));
  }
  if (/SOURCE_PIPELINE_FAILURE|SOURCE_PIPELINE_TERMINAL_STATUS|SOURCE_ACTOR_INVARIANT_FAILURE/.test(
      out.stderr?.toString('utf8')??'')) {
    throw new Error(backend+' reported a runtime invariant/terminal failure');
  }
  return parseCanonicalAudit(out.output?.[3]);
}
function argsMap(args) {
  const flags=new Map();
  for (let i=0;i<args.length;i+=2) {
    if (!args[i]?.startsWith('--') || !args[i+1] || flags.has(args[i])) throw new Error('invalid arguments');
    flags.set(args[i], args[i+1]);
  }
  const expected=['--llvm-runner','--graal-runner','--llvm-authority','--graal-authority'];
  if (flags.size!==4 || expected.some(k=>!flags.has(k))) throw new Error('both backend runners and preprovisioned authority files required');
  return flags;
}
export function main(argv) {
  const args=argsMap(argv);
  const {manifest,source}=loadManifest();
  // Each trusted runtime may emit its registry authority during guest startup.
  // Read the separately provisioned host authority files only after both runs.
  // They must be generated before the corresponding guest DATA admission.
  const captures=BACKENDS.map((b,i)=>runBackend(resolve(args.get(i?'--graal-runner':'--llvm-runner')),b,manifest,source));
  const authority=BACKENDS.map((_,i)=>JSON.parse(fileBytes(resolve(args.get(i?'--graal-authority':'--llvm-authority')),32768).toString('utf8')));
  return compareCaptures(captures[0],captures[1],manifest,authority[0],authority[1]);
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))); }
  catch (e) { console.error('V2 guest certification NOT PASSED:', e.message); process.exitCode=1; }
}
