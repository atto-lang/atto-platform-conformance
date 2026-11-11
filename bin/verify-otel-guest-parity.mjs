// Evidence-envelope verifier for real, independently executed Oreslang OTel guests.
// IMPORTANT: Validating self-reported metadata and captured bytes is NOT execution
// attestation; the trusted CI/GitHub verifier must independently corroborate them.
import { createHash } from 'node:crypto';
import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LIMIT = 1024 * 1024;
const EXACT_COMMON = ['schema', 'signal', 'timestamp_unix_ms', 'service', 'ores_trace_id'];
const FIELDS = Object.freeze({
  log: ['span_id', 'severity', 'body'],
  span: ['span_id', 'parent_span_id', 'name', 'duration_ns', 'outcome', 'http_status'],
  metric: ['name', 'kind', 'unit', 'value'],
});
export const PROFILES = Object.freeze({
  'java-graalvm-jit': ['java', 'ores-truffle-oreslang/oreslang-source.java'],
  'java-graalvm-native-aot': ['java', 'ores-truffle-oreslang/oreslang-source.java'],
  'llvm-native': ['llvm', 'ores-truffle-oreslang/oreslang-source.llvm'],
  'wasm-node-worker': ['wasm', 'ores-truffle-oreslang/oreslang-source.wasm'],
  'forge-native': ['forge', 'ores-truffle-oreslang/oreslang-source.forge'],
  'net-native-aot': ['net', 'ores-truffle-oreslang/oreslang-source.net'],
});
const gitFixtureBlob = 'c22a8841b868cd89dd4cb720435d9585fbbb05cc';
const gitLibraryBlob = '6a1b9b940f10e4b273ae2b02be5cfff5e0572afc';

function demand(ok, message) {
  if (!ok) throw new Error('OTEL_PARITY_DENIED: ' + message);
}
function exact(obj, keys, context) {
  demand(obj && typeof obj === 'object' && !Array.isArray(obj), context + ' must be an object');
  demand(Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k)),
    context + ' must have exactly approved fields');
}
function sha(value, regex, field) {
  demand(typeof value === 'string' && regex.test(value) && /[1-9a-f]/.test(value),
    'invalid ' + field);
}
function integer(value, field, min = 0) {
  demand(Number.isSafeInteger(value) && value >= min, 'invalid ' + field);
}
function string(value, field, max = 4096) {
  demand(typeof value === 'string' && value.length <= max, 'invalid ' + field);
}

// Parse a valid JSON document while rejecting repeated object keys, including
// Unicode-escaped aliases (JSON.parse alone silently accepts duplicate keys).
export function parseUniqueJSON(text) {
  demand(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= LIMIT,
    'JSON input exceeds limit');
  let cursor = 0;
  const space = () => { while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++; };
  const quoted = () => {
    demand(text[cursor] === '"', 'expected quoted key or string');
    const start = cursor++;
    let escaped = false;
    while (cursor < text.length) {
      const c = text[cursor++];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error('OTEL_PARITY_DENIED: unterminated JSON string');
  };
  const visit = depth => {
    demand(depth <= 32, 'JSON nesting limit');
    space();
    const c = text[cursor];
    if (c === '{') {
      cursor++;
      space();
      const seen = new Set();
      if (text[cursor] === '}') { cursor++; return; }
      for (;;) {
        space();
        const key = quoted();
        demand(!seen.has(key), 'duplicate JSON key');
        seen.add(key);
        space();
        demand(text[cursor++] === ':', 'missing JSON colon');
        visit(depth + 1);
        space();
        const delimiter = text[cursor++];
        if (delimiter === '}') return;
        demand(delimiter === ',', 'invalid JSON object delimiter');
      }
    }
    if (c === '[') {
      cursor++;
      space();
      if (text[cursor] === ']') { cursor++; return; }
      for (;;) {
        visit(depth + 1);
        space();
        const delimiter = text[cursor++];
        if (delimiter === ']') return;
        demand(delimiter === ',', 'invalid JSON array delimiter');
      }
    }
    if (c === '"') { quoted(); return; }
    const start = cursor;
    while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor++;
    demand(cursor > start, 'invalid JSON primitive');
    JSON.parse(text.slice(start, cursor));
  };
  visit(0);
  space();
  demand(cursor === text.length, 'trailing JSON data');
  return JSON.parse(text);
}

export function checkGuestStdout(bytes) {
  demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMIT,
    'missing or oversized raw guest stdout');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  demand(text.endsWith('\n'), 'stdout missing final JSONL newline');
  const lines = text.slice(0, -1).split('\n');
  demand(lines.length === 9, 'guest emitted unexpected telemetry record count');
  const rows = lines.map(line => {
    demand(Buffer.byteLength(line, 'utf8') <= 16384, 'oversized telemetry JSONL record');
    return parseUniqueJSON(line);
  });
  const signals = rows.map(row => row.signal);
  demand(signals.join(',') === 'log,log,log,log,log,log,span,span,metric',
    'incorrect ordered log/span/metric signal sequence');
  for (const row of rows) {
    const extra = FIELDS[row.signal];
    demand(extra, 'unknown telemetry signal');
    exact(row, [...EXACT_COMMON, ...extra], 'telemetry record');
    demand(row.schema === 'oreslang-otel.v1', 'telemetry schema mismatch');
    demand(row.service === 'test' && row.ores_trace_id === 'ores-trace-test',
      'service/trace attribution mismatch');
    integer(row.timestamp_unix_ms, 'timestamp_unix_ms', 1);
  }
  demand(rows.slice(0, 6).every(row => typeof row.body === 'string' &&
    typeof row.span_id === 'string' && row.span_id.length > 0),
    'log span/body types invalid');
  demand(rows.slice(0, 6).map(row => row.severity).join(',') ===
    'INFO,INFO,INFO,WARN,INFO,INFO', 'severity gating failed');
  const expectedBodies = [
    'quote" slash\\ newline\n nul\u0000 tab\t emoji😀',
    Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join(''),
    '-9223372036854775808|9223372036854775807|0|-1|100',
    'visible warning', 'visible all', 'visible equal',
  ];
  for (let i = 0; i < expectedBodies.length; i++) {
    demand(rows[i].body === expectedBodies[i],
      'smoke log body/Unicode/control/int64 mismatch at record ' + i);
  }
  const times = rows.map(row => row.timestamp_unix_ms);
  demand(Math.max(...times) - Math.min(...times) <= 300000,
    'telemetry timestamps span beyond bounded smoke window');
  const [child, root] = rows.slice(6, 8);
  for (const span of [child, root]) {
    string(span.span_id, 'span_id', 128);
    demand(span.span_id.length > 0 && span.outcome === 'ok', 'invalid span identity/outcome');
    integer(span.duration_ns, 'duration_ns');
    integer(span.http_status, 'http_status');
  }
  demand(root.name === 'request' && child.name === 'child',
    'root/child span names changed');
  demand(root.parent_span_id === '' && child.parent_span_id === root.span_id &&
    root.span_id !== child.span_id, 'parent-child span provenance invalid');
  demand(rows.slice(0, 6).every(r => r.span_id === root.span_id),
    'log-to-span correlation invalid');
  demand(root.http_status === 200 && child.http_status === 0,
    'root or child status changed');
  const metric = rows[8];
  demand(metric.name === 'requests' && metric.kind === 'counter' &&
    metric.unit === '1' && metric.value === 1, 'metric observation differs');
  for (const row of rows) {
    if (row.signal === 'log') {
      demand(row.body.length <= 4096 && row.span_id.length <= 128,
        'log attributes exceed bounded string admission');
    }
  }
  return { records: 9, logs: 6, spans: 2, metrics: 1 };
}

export function verifyReceipt(receipt, capture) {
  exact(receipt, [
    'schema', 'backend', 'profile', 'compiler_repository',
    'compiler_source_sha', 'compiler_tree_sha', 'compiler_executable_sha256',
    'fixture_git_blob', 'library_git_blob', 'guest_artifact_sha256',
    'stdout_sha256', 'compile_exit_code', 'guest_exit_code',
    'command_argv', 'ci',
  ], 'guest receipt');
  demand(receipt.schema === 'oreslang-otel-guest-receipt/v1', 'unknown receipt schema');
  const profile = PROFILES[receipt.profile];
  demand(profile && receipt.backend === profile[0] &&
    receipt.compiler_repository === profile[1], 'backend/compiler/profile substitution');
  for (const field of ['compiler_source_sha', 'compiler_tree_sha']) sha(receipt[field], SHA40, field);
  for (const field of ['compiler_executable_sha256', 'guest_artifact_sha256', 'stdout_sha256'])
    sha(receipt[field], SHA256, field);
  demand(receipt.fixture_git_blob === gitFixtureBlob &&
    receipt.library_git_blob === gitLibraryBlob, 'unreviewed telemetry guest source');
  demand(receipt.compile_exit_code === 0 && receipt.guest_exit_code === 0,
    'compiler or guest did not exit successfully');
  demand(Array.isArray(receipt.command_argv) && receipt.command_argv.length > 0 &&
    receipt.command_argv.length <= 40, 'invalid guest command argv');
  for (const [index, arg] of receipt.command_argv.entries()) {
    string(arg, 'command argv', 4096);
    demand(arg.length > 0 && !/[\u0000-\u001f]/.test(arg), 'hostile guest command argument');
    if (index === 0) {
      demand(arg.startsWith('/') || /^[A-Za-z]:\\/.test(arg), 'guest executable not absolute');
      demand(!/(?:^|[\\/])(sh|bash|zsh|python|python3|env|node-eval)(?:\.exe)?$/i.test(arg),
        'indirect shell/Python guest launcher not accepted');
    }
  }
  exact(receipt.ci, ['run_id', 'job_id', 'runner_id', 'executed_steps',
    'source_checkout_sha', 'run_url'], 'CI provenance declaration');
  for (const field of ['run_id', 'job_id', 'runner_id', 'executed_steps'])
    integer(receipt.ci[field], 'ci.' + field, 1);
  sha(receipt.ci.source_checkout_sha, SHA40, 'ci.source_checkout_sha');
  demand(receipt.ci.source_checkout_sha === receipt.compiler_source_sha,
    'compiler source checkout SHA does not match declared compiler SHA');
  demand(receipt.ci.run_url ===
    'https://github.com/' + receipt.compiler_repository + '/actions/runs/' + receipt.ci.run_id,
    'CI run URL cannot be bound to compiler repository');
  const actual = createHash('sha256').update(capture).digest('hex');
  demand(actual === receipt.stdout_sha256, 'raw stdout digest does not match receipt');
  const summary = checkGuestStdout(capture);
  return {
    backend: receipt.backend, profile: receipt.profile, ...summary,
    classification: 'RECEIPT_SHAPE_AND_CAPTURE_ONLY',
    compilerExecutedIndependentlyVerified: false,
    releaseCertified: false,
  };
}

function boundedFile(path) {
  const fd = openSync(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(fd);
    demand(before.isFile() && before.size > 0 && before.size <= LIMIT && before.nlink === 1,
      'receipt/stdout must be a bounded regular single-link file');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, null);
      demand(read > 0, 'receipt/stdout truncated during read');
      offset += read;
    }
    const extra = Buffer.alloc(1);
    demand(readSync(fd, extra, 0, 1, null) === 0,
      'receipt/stdout grew during bounded read');
    const after = fstatSync(fd);
    demand(bytes.length === before.size && before.size === after.size &&
      before.ino === after.ino && before.dev === after.dev &&
      before.mtimeMs === after.mtimeMs, 'receipt/stdout changed during read');
    return bytes;
  } finally { closeSync(fd); }
}

export function verifyFiles(receiptPath, stdoutPath) {
  const receiptBytes = boundedFile(receiptPath);
  const stdoutBytes = boundedFile(stdoutPath);
  const receipt = parseUniqueJSON(new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes));
  return verifyReceipt(receipt, stdoutBytes);
}

function main(argv) {
  demand(argv.length === 2 || (argv.length === 3 && argv[2] === '--require-parity'),
    'usage: node verify-otel-guest-parity.mjs <receipt.json> <stdout.jsonl> [--require-parity]');
  // Guard before parsing or printing any valid-looking receipt. This mode
  // MUST produce no successful-looking stdout even with valid synthetic data.
  if (argv.length === 3) {
    throw new Error('OTEL_PARITY_DENIED: shape-only checks cannot certify a compiler');
  }
  const result = verifyFiles(argv[0], argv[1]);
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (err) {
    process.stderr.write(String(err.message).slice(0, 300) + '\n');
    process.exitCode = 1;
  }
}
