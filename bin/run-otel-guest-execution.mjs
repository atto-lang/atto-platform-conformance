// Opt-in REAL compiler and guest process runner. No fake-compiler fallback.
// This captures a candidate; only independently verified trusted CI can certify.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, mkdtempSync, openSync,
  readSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkGuestStdout, PROFILES } from './verify-otel-guest-parity.mjs';

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const MAX_EXECUTABLE = 512 * 1024 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const EXE_DENY = /(?:^|[\\/])(sh|bash|zsh|dash|python|python3|env)(?:\.exe)?$/i;
const EXPECTED_FIXTURE = 'c22a8841b868cd89dd4cb720435d9585fbbb05cc';
const EXPECTED_LIBRARY = '6a1b9b940f10e4b273ae2b02be5cfff5e0572afc';

function deny(reason) { throw new Error('OTEL_REAL_GUEST_DENIED: ' + reason); }
function need(test, reason) { if (!test) deny(reason); }
function hex(x, regex, label) {
  need(typeof x === 'string' && regex.test(x) && /[1-9a-f]/.test(x), 'invalid ' + label);
}
function readBounded(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    need(stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= limit,
      'not a bounded regular file');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const n = readSync(fd, data, offset, data.length - offset, null);
      need(n > 0, 'input truncated during bounded read');
      offset += n;
    }
    const extra = Buffer.alloc(1);
    need(readSync(fd, extra, 0, 1, null) === 0, 'input grew during bounded read');
    const after = fstatSync(fd);
    need(after.size === stat.size && after.ino === stat.ino &&
      after.dev === stat.dev && after.mtimeMs === stat.mtimeMs,
      'input changed while reading');
    return data;
  } finally { closeSync(fd); }
}
function hashFile(path, max = MAX_EXECUTABLE) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    need(stat.isFile() && stat.size > 0 && stat.size <= max,
      'binary/artifact is not a bounded regular file');
    const hash = createHash('sha256');
    const buf = Buffer.allocUnsafe(65536);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      need(total <= max, 'file grew beyond budget');
      hash.update(buf.subarray(0, n));
    }
    const after = fstatSync(fd);
    need(total === stat.size && after.size === stat.size &&
      after.ino === stat.ino && after.dev === stat.dev &&
      after.mtimeMs === stat.mtimeMs, 'binary/artifact changed during hashing');
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function git(root, ...argv) {
  const r = spawnSync('git', ['-C', root, ...argv], {
    shell: false, timeout: 10000, encoding: 'utf8', maxBuffer: 65536,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/tmp',
      GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' },
  });
  need(!r.error && r.status === 0, 'Git identity/cleanliness check failed');
  return r.stdout.trim();
}
function sourceRoot(root, expectedSha, label) {
  need(isAbsolute(root), label + ' checkout must be an absolute path');
  hex(expectedSha, HEX40, label + ' head');
  const physical = realpathSync(root);
  need(git(physical, 'rev-parse', '--show-toplevel') === physical,
    label + ' must point to git checkout root');
  need(git(physical, 'rev-parse', 'HEAD') === expectedSha, label + ' original head drift');
  need(git(physical, 'status', '--porcelain', '--untracked-files=all') === '',
    label + ' dirty checkout');
  return { path: physical, tree: git(physical, 'rev-parse', 'HEAD^{tree}') };
}
function pinSourceBlob(path, expected) {
  const bytes = readBounded(path, 1024 * 1024);
  const gitBlob = createHash('sha1').update('blob ' + bytes.length + '\0')
    .update(bytes).digest('hex');
  need(gitBlob === expected, 'telemetry guest/library source blob differs');
  return bytes;
}
function checkedExe(path, expected, label) {
  need(typeof path === 'string' && isAbsolute(path), 'non-absolute ' + label);
  const actual = realpathSync(path);
  need(!EXE_DENY.test(actual), 'indirect shell/Python executable disallowed');
  hex(expected, HEX64, label + ' sha256');
  need(hashFile(actual) === expected, label + ' binary hash mismatch');
  return actual;
}
export function args(template, substitutions, label) {
  need(Array.isArray(template) && template.length >= 1 && template.length <= 40,
    label + ' argv must be bounded nonempty array');
  const hostile = new Set(['-e', '--eval', '--evaluate', '--print', '-p', '-c',
    '--command', '--input-type', '--import', '--require']);
  return template.map(arg => {
    need(typeof arg === 'string' && arg.length > 0 && arg.length <= 4096 &&
      !/[\u0000-\u001f]/.test(arg), label + ' invalid argument');
    need(!hostile.has(arg) && !arg.startsWith('--eval=') &&
      !arg.startsWith('--print=') && !arg.startsWith('--input-type='),
      label + ' must not use inline interpreter code or preload flags');
    return arg.replaceAll('{fixture}', substitutions.fixture)
      .replaceAll('{artifact}', substitutions.artifact)
      .replaceAll('{compiler}', substitutions.compiler);
  });
}
function spawnReal(argv, cwd, timeoutMs, label) {
  need(isAbsolute(argv[0]), label + ' must have an absolute executable');
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG',
    'JAVA_HOME', 'DOTNET_ROOT', 'RUSTUP_HOME', 'CARGO_HOME']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const result = spawnSync(argv[0], argv.slice(1), {
    shell: false, cwd, env, windowsHide: true,
    timeout: timeoutMs, maxBuffer: MAX_OUTPUT + 1, encoding: null,
  });
  need(!result.error && result.status === 0 && result.signal == null,
    label + ' actual process failed, timed out or exceeded output quota');
  need(Buffer.isBuffer(result.stdout) && result.stdout.length <= MAX_OUTPUT,
    label + ' stdout exceeded byte budget');
  return result;
}
// A compiler emitting a shell script or a copied source file is not a native
// AOT executable. These are shallow magic-byte admissions, NOT proof of
// provenance or an executable's runtime behavior.
export function checkGeneratedArtifact(path, profile) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let magic;
  try {
    const stat = fstatSync(fd);
    need(stat.isFile() && stat.size >= 4 && stat.size <= MAX_EXECUTABLE,
      'generated artifact must be a bounded regular binary');
    magic = Buffer.alloc(4);
    need(readSync(fd, magic, 0, 4, 0) === 4,
      'generated artifact truncated');
  } finally { closeSync(fd); }
  const isWasm = magic.equals(Buffer.from([0, 0x61, 0x73, 0x6d]));
  const isELF = magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const isPE = magic[0] === 0x4d && magic[1] === 0x5a;
  const isMachO = ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe'].includes(magic.toString('hex'));
  if (profile === 'wasm-node-worker') {
    need(isWasm, 'Wasm profile must execute a compiled WebAssembly module');
  } else {
    need(isELF || isPE || isMachO,
      'Native/AOT profile must produce a native executable, not a script or source');
  }
  return true;
}

export function checkConfiguration(config) {
  need(config && typeof config === 'object' && !Array.isArray(config),
    'missing real-guest execution config');
  const keys = ['schema','profile','backend_source_root','backend_source_sha',
    'otel_source_root','otel_source_sha','compiler_executable','compiler_binary_sha256',
    'dependency_pins','compile_argv','run_argv','artifact_kind','timeout_ms'];
  need(Object.keys(config).length === keys.length && keys.every(k => Object.hasOwn(config,k)),
    'execution config has unknown or missing keys');
  need(config.schema === 'oreslang-otel-real-guest-execution/v1', 'wrong config schema');
  need(PROFILES[config.profile], 'unknown exact backend runtime profile');
  need(['generated','source_fixture'].includes(config.artifact_kind),
    'artifact kind is not declared');
  need(config.artifact_kind !== 'source_fixture' ||
    config.profile === 'java-graalvm-jit', 'only Java JIT can use source guest artifact');
  const placeholders = { compiler: '/pinned-compiler', fixture: '/pinned-fixture',
    artifact: '/generated-artifact' };
  args(config.compile_argv, placeholders, 'compiler');
  args(config.run_argv, placeholders, 'guest');
  need(config.compile_argv[0] === '{compiler}',
    'compiler entrypoint must use the verified compiler placeholder');
  need(config.compile_argv.some(a => a.includes('{fixture}')),
    'compiler must consume the pinned fixture');
  need(config.artifact_kind === 'source_fixture' ||
    config.compile_argv.some(a => a.includes('{artifact}')),
    'generated compiler must write output to designated artifact');
  need(config.run_argv.some(a => a.includes(
    config.artifact_kind === 'source_fixture' ? '{fixture}' : '{artifact}')),
    'guest must consume pinned source or generated artifact');
  need(Number.isSafeInteger(config.timeout_ms) &&
    config.timeout_ms >= 1000 && config.timeout_ms <= 180000, 'invalid process timeout');
  need(Array.isArray(config.dependency_pins) && config.dependency_pins.length <= 32,
    'invalid extra toolchain dependency pins');
  for (const pin of config.dependency_pins) {
    need(pin && Object.keys(pin).sort().join(',') === 'path,sha256',
      'dependency pin must contain only path+sha256');
    need(isAbsolute(pin.path), 'dependent toolchain path not absolute');
    hex(pin.sha256, HEX64, 'dependent artifact hash');
  }
  return PROFILES[config.profile];
}

export function captureReal(config) {
  const [backend, repo] = checkConfiguration(config);
  const checkout = sourceRoot(config.backend_source_root, config.backend_source_sha, repo);
  const source = sourceRoot(config.otel_source_root, config.otel_source_sha,
    'ores-truffle-oreslang/oreslang-otel');
  const fixture = join(source.path, 'tests', 'smoke.ores');
  const library = join(source.path, 'src', 'otel.ores');
  const fixtureBytes = pinSourceBlob(fixture, EXPECTED_FIXTURE);
  pinSourceBlob(library, EXPECTED_LIBRARY);
  const compiler = checkedExe(config.compiler_executable,
    config.compiler_binary_sha256, 'compiler');
  for (const pin of config.dependency_pins) checkedExe(pin.path, pin.sha256, 'dependency');
  const outputDir = mkdtempSync(join(tmpdir(), 'ores-otel-real-guest-'));
  const artifact = join(outputDir, config.profile === 'wasm-node-worker' ?
    'guest-artifact.wasm' : process.platform === 'win32' ?
      'guest-artifact.exe' : 'guest-artifact');
  const substitution = { fixture, artifact, compiler };
  const compile = args(config.compile_argv, substitution, 'compiler');
  const run = args(config.run_argv, substitution, 'guest');
  need(compile[0] === compiler, 'compile argv cannot substitute another compiler');
  need(config.compile_argv.some(arg => arg.includes('{fixture}')),
    'compiler argv must consume the pinned source-owned fixture');
  need(config.artifact_kind !== 'generated' ||
    config.compile_argv.some(arg => arg.includes('{artifact}')),
    'generated guest compiler must write to the designated artifact');
  need(config.run_argv.some(arg => arg.includes(config.artifact_kind ===
    'generated' ? '{artifact}' : '{fixture}')),
    'guest argv must consume the pinned source fixture or generated artifact');
  // An approved host launcher (node/java/dotnet) must itself be pinned as a
  // dependency; native-generated guest may execute its own freshly hashed artifact.
  const approvedRunExecutables = new Set([
    compiler, artifact, ...config.dependency_pins.map(p => realpathSync(p.path)),
  ]);
  need(approvedRunExecutables.has(run[0]), 'unapproved guest runtime executable');
  spawnReal(compile, source.path, config.timeout_ms, 'compiler');
  const guestArtifact = config.artifact_kind === 'source_fixture' ? fixture : artifact;
  const artifactHash = hashFile(guestArtifact);
  if (config.artifact_kind === 'generated') {
    checkGeneratedArtifact(guestArtifact, config.profile);
  }
  need(config.artifact_kind === 'source_fixture' || run.includes(artifact),
    'native-generated artifact not actually executed by configured run');
  const executed = spawnReal(run, source.path, Math.min(config.timeout_ms,30000), 'guest');
  need(hashFile(guestArtifact) === artifactHash,
    'guest artifact bytes changed during or after execution');
  need(hashFile(compiler) === config.compiler_binary_sha256,
    'compiler executable bytes changed during capture');
  for (const pin of config.dependency_pins) {
    need(hashFile(realpathSync(pin.path)) === pin.sha256,
      'dependent runtime/toolchain executable bytes changed during capture');
  }
  const semantic = checkGuestStdout(executed.stdout);
  writeFileSync(join(outputDir, 'guest.stdout.jsonl'), executed.stdout,
    { mode: 0o600, flag: 'wx' });
  const candidate = {
    schema: 'oreslang-otel-local-capture/v1',
    backend, compiler_repository: repo, profile: config.profile,
    source_checkout_sha: config.backend_source_sha, source_tree_sha: checkout.tree,
    otel_source_sha: config.otel_source_sha, otel_source_tree_sha: source.tree,
    compiler_binary_sha256: config.compiler_binary_sha256,
    original_fixture_git_blob: EXPECTED_FIXTURE,
    original_library_git_blob: EXPECTED_LIBRARY,
    guest_artifact_kind: config.artifact_kind, guest_artifact_sha256: artifactHash,
    stdout_sha256: createHash('sha256').update(executed.stdout).digest('hex'),
    compile_argv: compile, run_argv: run, compile_exit_code: 0, guest_exit_code: 0,
    records: semantic.records, classification: 'REAL_PROCESS_CAPTURE_CANDIDATE_UNATTESTED',
    compilerSourceProvenanceIndependentlyVerified: false, parityCertified: false,
  };
  writeFileSync(join(outputDir, 'capture.json'), JSON.stringify(candidate,null,2) + '\n',
    { mode: 0o600, flag: 'wx' });
  return { outputDir, ...candidate };
}

function main() {
  need(process.argv.length === 3,
    'usage: node run-otel-guest-execution.mjs /absolute/path/to/config.json');
  const path = process.argv[2];
  need(isAbsolute(path), 'configuration path must be absolute');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBounded(path, 64 * 1024)));
  const result = captureReal(config);
  process.stdout.write(JSON.stringify({ outputDir: result.outputDir,
    classification: result.classification, backend: result.backend,
    profile: result.profile, records: result.records, parityCertified:false }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (e) {
    // Never dump command/environment or failed guest stderr; they can be sensitive.
    process.stderr.write(String(e.message).slice(0,250) + '\n');
    process.exitCode = 1;
  }
}
