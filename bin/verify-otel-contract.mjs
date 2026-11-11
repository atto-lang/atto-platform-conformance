// Source-only canonical OTel capability contract. A valid manifest always
// represents proposed conformance, NEVER a real compiled guest receipt.
import { lstatSync, readFileSync } from 'node:fs';
import { parseUniqueJSON } from './verify-otel-guest-parity.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILES = Object.freeze([
  ['java', 'java-graalvm-jit', 'ores-truffle-oreslang/oreslang-source.java'],
  ['java', 'java-graalvm-native-aot', 'ores-truffle-oreslang/oreslang-source.java'],
  ['llvm', 'llvm-native', 'ores-truffle-oreslang/oreslang-source.llvm'],
  ['wasm', 'wasm-node-worker', 'ores-truffle-oreslang/oreslang-source.wasm'],
  ['forge', 'forge-native', 'ores-truffle-oreslang/oreslang-source.forge'],
  ['net', 'net-native-aot', 'ores-truffle-oreslang/oreslang-source.net'],
]);
const STATUSES = Object.freeze({
  java: 'UNVERIFIED_AT_CURRENT_HEAD',
  llvm: 'UNVERIFIED_AT_CURRENT_HEAD',
  wasm: 'BLOCKED_GUEST_STDOUT_ABI',
  forge: 'BLOCKED_GUEST_LANGUAGE_SUBSET',
  net: 'BLOCKED_GUEST_LANGUAGE_SUBSET',
});

const REQUIRED_SECURITY = Object.freeze([
  'No private compiler source copied into any unapproved carrier',
  'No host fixture, simulated stdout, or contract test may be claimed as guest execution',
  'Ingress authorization and tenant identity are host/runtime-owned, never sourced from untrusted telemetry attributes',
  'Use opaque ores_trace_id distinct from W3C trace_id and span_id; do not claim OTLP mapping until an actual adapter executes',
  'Telemetry must not block actor carrier; drops/backpressure explicit; no secret keys or payload leakage',
  'Capture exact compiler source/tree SHA, binary SHA256, guest artifact SHA256, stdout SHA256 and real process exit statuses',
]);

function demand(ok, detail) {
  if (!ok) throw new Error('OTEL_CONTRACT_DENIED: ' + detail);
}
function exact(obj, fields, label) {
  demand(obj && typeof obj === 'object' && !Array.isArray(obj), label + ' must be object');
  demand(Object.keys(obj).length === fields.length &&
    fields.every(key => Object.hasOwn(obj, key)), label + ' has missing/extra fields');
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function validateContract(doc) {
  exact(doc, ['schema','classification','library','signals','requiredProfiles',
    'currentEvidence','security','promotion'], 'canonical OTel parity contract');
  demand(doc.schema === 'oreslang-otel-five-backend/v1' &&
    doc.classification === 'CANDIDATE_ONLY' &&
    doc.promotion === 'CONTRACT_SELF_TESTS_NEVER_PROVE_COMPILER_PARITY',
    'manifest tried to alter release evidence classification');
  exact(doc.library, ['repository','fixture','fixtureGitBlob','implementation',
    'implementationGitBlob','legacyExtension'], 'source-owned OTel identity');
  demand(same(doc.library, {
    repository: 'ores-truffle-oreslang/oreslang-otel',
    fixture: 'tests/smoke.ores',
    fixtureGitBlob: 'c22a8841b868cd89dd4cb720435d9585fbbb05cc',
    implementation: 'src/otel.ores',
    implementationGitBlob: '6a1b9b940f10e4b273ae2b02be5cfff5e0572afc',
    legacyExtension: '.ores',
  }), 'source/library changed without a reviewed versioned contract');
  exact(doc.signals, ['logs','spans','metrics','total'], 'telemetry signal counts');
  demand(same(doc.signals, {logs:6,spans:2,metrics:1,total:9}),
    'telemetry counts changed without versioned oracle');
  demand(Array.isArray(doc.requiredProfiles) &&
    doc.requiredProfiles.length === PROFILES.length, 'not all six profiles present');
  const profiles = doc.requiredProfiles.map(p => {
    exact(p, ['backend','profile','compiler'], 'required execution profile');
    return [p.backend, p.profile, p.compiler];
  });
  demand(same(profiles, PROFILES), 'invented/duplicated/reordered execution profile');
  demand(Array.isArray(doc.currentEvidence) &&
    doc.currentEvidence.length === Object.keys(STATUSES).length,
    'current evidence must list exactly five compilers');
  const actual = new Set();
  for (const row of doc.currentEvidence) {
    exact(row, ['backend','status','reason'], 'backend claim');
    demand(typeof row.backend === 'string' && Object.hasOwn(STATUSES, row.backend) &&
      !actual.has(row.backend), 'unknown or repeated backend');
    actual.add(row.backend);
    demand(row.status === STATUSES[row.backend], 'backend status falsely promoted');
    demand(typeof row.reason === 'string' &&
      row.reason.length >= 40 && row.reason.length <= 512,
      'unreviewed or missing capability limitation');
  }
  demand(Array.isArray(doc.security) && same(doc.security, REQUIRED_SECURITY),
    'security policy changed without a reviewed versioned contract');
  return {classification:'SOURCE_ONLY_CANDIDATE',profiles:PROFILES.length,
    backends:Object.keys(STATUSES).length,guestExecuted:false,releaseCertified:false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('OTEL_CONTRACT_DENIED: no extra arguments');
    const path = resolve('contracts/otel-five-backend-v1.json');
    const stat = lstatSync(path);
    demand(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 &&
      stat.size <= 64 * 1024, 'canonical contract is not a bounded regular file');
    const doc = parseUniqueJSON(readFileSync(path, 'utf8'));
    process.stdout.write(JSON.stringify(validateContract(doc))+'\n');
  } catch (err) {
    const message = String(err.message);
    process.stderr.write((message.startsWith('OTEL_CONTRACT_DENIED:') ?
      message.slice(0,240) : 'OTEL_CONTRACT_DENIED: malformed canonical contract')+'\n');
    process.exitCode=1;
  }
}
