import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const hex40 = /^[0-9a-f]{40}$/;
const diag = /^GPU-LAUNCH-0(?:0[1-9]|10)$/;
const backendNames = new Set(['llvm', 'java', 'net', 'wasm', 'forge', 'cranelift', 'js']);

export function gitBlobSha(bytes) {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
function fail(message) { throw new Error(`GPU_NEGATIVE_GATE: ${message}`); }
function regularFile(name) {
  const stat = lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('non-regular/hardlinked file');
  return stat;
}
function readPinned(sourceRoot, candidate) {
  if (!/^fixtures\/gpu-launch-v1\/[a-z0-9-]+\.atto$/.test(candidate.path))
    fail('invalid manifest fixture path');
  if (!hex40.test(candidate.gitBlobSha)) fail('invalid source Git blob');
  const filename = path.resolve(sourceRoot, candidate.path);
  if (!filename.startsWith(path.resolve(sourceRoot) + path.sep)) fail('source escapes fixture root');
  if (regularFile(filename).size > 64 * 1024) fail('fixture exceeds byte limit');
  const bytes = readFileSync(filename);
  if (gitBlobSha(bytes) !== candidate.gitBlobSha) fail(`fixture modified: ${candidate.id}`);
  return bytes;
}
function invoke(argv, sourcePath, cwd, timeoutMs) {
  const result = spawnSync(argv[0], [...argv.slice(1), sourcePath], {
    cwd, shell: false, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1_048_576,
    windowsHide: true
  });
  if (result.error) fail(`compiler process unavailable: ${result.error.code ?? 'UNKNOWN'}`);
  if (result.signal !== null) fail(`compiler terminated by signal: ${result.signal}`);
  return result;
}

/**
 * This independently invokes a configured compiler binary, never an emulator.
 * Successful negative diagnostics demonstrate ONLY a negative compiler gate.
 * They never prove accepted .atto GPU source, guest execution, or a real GPU.
 */
export function runNegativeGpuCompilerGate({
  sourceRoot, manifest, controlSource, backend, compilerArgv,
  sourceHead, sourceTree, timeoutMs = 10_000
}) {
  if (!backendNames.has(backend)) fail('unknown backend');
  if (!hex40.test(sourceHead) || !hex40.test(sourceTree)) fail('missing exact source head/tree');
  if (!Array.isArray(compilerArgv) || compilerArgv.length < 1 ||
      compilerArgv.some(a => typeof a !== 'string' || !a.length)) fail('missing executable argv');
  if (!path.isAbsolute(compilerArgv[0])) fail('compiler must be an absolute executable path');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    fail('invalid per-fixture timeout');
  regularFile(compilerArgv[0]);
  if (manifest?.schema !== 'attolang.gpu-explicit-launch-corpus/1' ||
      !Array.isArray(manifest.cases)) fail('unexpected contract corpus');
  const negatives = manifest.cases.filter(c => c.expectation === 'negative');
  if (negatives.length === 0 || negatives.length !== new Set(negatives.map(c => c.id)).size)
    fail('missing or duplicate negative cases');
  if (negatives.some(c => !diag.test(c.expectedDiagnostic) || c.observedResult !== 'NOT_EXECUTED'))
    fail('invalid negative-case contract');
  if (!Buffer.isBuffer(controlSource) || controlSource.length === 0 || controlSource.length > 65536)
    fail('missing bounded independent scalar compiler control');

  const workspace = mkdtempSync(path.join(tmpdir(), 'atto-gpu-negative-gate-'));
  const receipts = [];
  try {
    const controlDir = path.join(workspace, 'scalar-control');
    mkdirSync(controlDir);
    const controlFile = path.join(controlDir, 'launch-function.atto');
    writeFileSync(controlFile, controlSource, {flag: 'wx', mode: 0o600});
    const control = invoke(compilerArgv, controlFile, controlDir, timeoutMs);
    if (control.status !== 0) fail('independent scalar compiler control did not compile');

    for (const c of negatives) {
      if (typeof c.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(c.id)) fail('unsafe case identifier');
      const bytes = readPinned(sourceRoot, c);
      const caseDir = path.join(workspace, c.id);
      mkdirSync(caseDir);
      const testSource = path.join(caseDir, 'case.atto');
      writeFileSync(testSource, bytes, {flag: 'wx', mode: 0o600});
      const result = invoke(compilerArgv, testSource, caseDir, timeoutMs);
      if (!Number.isInteger(result.status) || result.status === 0)
        fail(`${c.id}: unsupported GPU source was compiled`);
      if (result.stdout !== '') fail(`${c.id}: rejected GPU source emitted stdout`);
      const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      const diagnosticLine = new RegExp(`^(?:error:\\s*)?${c.expectedDiagnostic}:`, 'im');
      if (!diagnosticLine.test(result.stderr))
        fail(`${c.id}: missing required diagnostic ${c.expectedDiagnostic}`);
      if (/CPU fallback|fallback to CPU|CPU execution/i.test(combined) &&
          !/no implicit CPU fallback/i.test(combined)) fail(`${c.id}: potential CPU fallback`);
      const after = readdirSync(caseDir);
      if (after.length !== 1 || after[0] !== 'case.atto')
        fail(`${c.id}: rejected input created an executable or other artifact`);
      if (gitBlobSha(readFileSync(testSource)) !== c.gitBlobSha)
        fail(`${c.id}: copied source mutated by compiler`);
      receipts.push(Object.freeze({id: c.id, sourceBlob: c.gitBlobSha,
        diagnostic: c.expectedDiagnostic, exitCode: result.status,
        outputDigest: createHash('sha256').update(combined).digest('hex')}));
    }
  } finally {
    rmSync(workspace, {recursive: true, force: true});
  }
  return Object.freeze({
    schema: 'attolang.gpu-compiler-negative-receipt/1', backend,
    sourceHead, sourceTree, compilerSha256: createHash('sha256')
      .update(readFileSync(compilerArgv[0])).digest('hex'),
    evidenceClass: 'COMPILER_PROCESS_NEGATIVE_ONLY_UNATTESTED',
    scalarControlCompiled: true, negativeCount: receipts.length,
    compilerGuestExecuted: false, physicalGpuExecuted: false,
    positives: 'NOT_EXECUTED', negatives: Object.freeze(receipts)
  });
}
