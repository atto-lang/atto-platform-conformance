import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkGuestStdout, parseUniqueJSON, verifyReceipt, PROFILES } from '../bin/verify-otel-guest-parity.mjs';

const stamp = 1794400000000;
const root = 'opaque-span-root';
const child = 'opaque-span-child';
const common = { schema: 'oreslang-otel.v1', timestamp_unix_ms: stamp,
  service: 'test', ores_trace_id: 'ores-trace-test' };

function sampleCapture() {
  const message = [
    'quote" slash\\ newline\n nul\u0000 tab\t emoji😀',
    Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join(''),
    '-9223372036854775808|9223372036854775807|0|-1|100',
    'visible warning', 'visible all', 'visible equal',
  ];
  const rows = message.map((body, i) => ({
    ...common, signal: 'log', span_id: root,
    severity: i === 3 ? 'WARN' : 'INFO', body,
  }));
  rows.push({ ...common, signal: 'span', span_id: child, parent_span_id: root,
    name: 'child', duration_ns: 42, outcome: 'ok', http_status: 0 });
  rows.push({ ...common, signal: 'span', span_id: root, parent_span_id: '',
    name: 'request', duration_ns: 150, outcome: 'ok', http_status: 200 });
  rows.push({ ...common, signal: 'metric', name: 'requests',
    kind: 'counter', unit: '1', value: 1 });
  return Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

function sampleReceipt(capture, profile = 'java-graalvm-jit') {
  const [backend, repo] = PROFILES[profile];
  return {
    schema: 'oreslang-otel-guest-receipt/v1',
    backend, profile, compiler_repository: repo,
    compiler_source_sha: 'a'.repeat(40), compiler_tree_sha: 'b'.repeat(40),
    compiler_executable_sha256: 'c'.repeat(64),
    fixture_git_blob: 'c22a8841b868cd89dd4cb720435d9585fbbb05cc',
    library_git_blob: '6a1b9b940f10e4b273ae2b02be5cfff5e0572afc',
    guest_artifact_sha256: 'd'.repeat(64),
    stdout_sha256: createHash('sha256').update(capture).digest('hex'),
    compile_exit_code: 0, guest_exit_code: 0,
    command_argv: ['/opt/approved/compiler', '--run', '/tmp/source.ores'],
    ci: { run_id: 42, job_id: 73, runner_id: 2, executed_steps: 8,
      source_checkout_sha: 'a'.repeat(40),
      run_url: 'https://github.com/' + repo + '/actions/runs/42' },
  };
}

const expectDenied = fn => assert.throws(fn, /OTEL_PARITY_DENIED|JSON|SyntaxError/);

test('valid shape for each of six profiles NEVER certifies any compiler', () => {
  const capture = sampleCapture();
  for (const profile of Object.keys(PROFILES)) {
    const out = verifyReceipt(sampleReceipt(capture, profile), capture);
    assert.equal(out.records, 9);
    assert.equal(out.releaseCertified, false);
    assert.equal(out.compilerExecutedIndependentlyVerified, false);
    assert.equal(out.classification, 'RECEIPT_SHAPE_AND_CAPTURE_ONLY');
  }
});

test('captures exact log/span/metric sequence and int64-as-text', () => {
  assert.deepEqual(checkGuestStdout(sampleCapture()),
    { records: 9, logs: 6, spans: 2, metrics: 1 });
});

test('duplicate top-level or nested keys reject including escaped aliases', () => {
  expectDenied(() => parseUniqueJSON('{"backend":"java","back\\u0065nd":"llvm"}'));
  expectDenied(() => parseUniqueJSON('{"ci":{"run_id":3,"run_id":4}}'));
  expectDenied(() => parseUniqueJSON('{"signal":"log"} trailing'));
});

test('mixed backend identities or invented profile always reject', () => {
  const capture = sampleCapture();
  const wrong = sampleReceipt(capture);
  wrong.backend = 'llvm';
  expectDenied(() => verifyReceipt(wrong, capture));
  wrong.backend = 'java';
  wrong.compiler_repository = 'attack-owner/oreslang-source.java';
  expectDenied(() => verifyReceipt(wrong, capture));
  wrong.compiler_repository = 'ores-truffle-oreslang/oreslang-source.java';
  wrong.profile = 'unknown-execution';
  expectDenied(() => verifyReceipt(wrong, capture));
});

test('missing/stale compiler and fixture identities deny promotion', () => {
  const capture = sampleCapture();
  const invalid = sampleReceipt(capture);
  invalid.fixture_git_blob = 'a'.repeat(40);
  expectDenied(() => verifyReceipt(invalid, capture));
  invalid.fixture_git_blob = 'c22a8841b868cd89dd4cb720435d9585fbbb05cc';
  invalid.compiler_executable_sha256 = '0'.repeat(64);
  expectDenied(() => verifyReceipt(invalid, capture));
  invalid.compiler_executable_sha256 = 'c'.repeat(64);
  invalid.ci.source_checkout_sha = 'f'.repeat(40);
  expectDenied(() => verifyReceipt(invalid, capture));
});

test('zero-step, no runner, failed guest or forged GitHub run reject', () => {
  const capture = sampleCapture();
  const r = sampleReceipt(capture);
  r.ci.executed_steps = 0;
  expectDenied(() => verifyReceipt(r, capture));
  r.ci.executed_steps = 8;
  r.ci.runner_id = 0;
  expectDenied(() => verifyReceipt(r, capture));
  r.ci.runner_id = 2;
  r.guest_exit_code = 1;
  expectDenied(() => verifyReceipt(r, capture));
  r.guest_exit_code = 0;
  r.ci.run_url = 'https://github.com/other/repo/actions/runs/42';
  expectDenied(() => verifyReceipt(r, capture));
});

test('raw stdout hash must bind immutable captured output bytes', () => {
  const capture = sampleCapture();
  const r = sampleReceipt(capture);
  const tampered = Buffer.from(capture);
  tampered[20] = tampered[20] === 0x61 ? 0x62 : 0x61;
  expectDenied(() => verifyReceipt(r, tampered));
});

test('span, source, metric, log attribution tampering rejects', () => {
  const capture = sampleCapture();
  const mutate = fn => {
    const rows = capture.toString().trimEnd().split('\n').map(JSON.parse);
    fn(rows);
    expectDenied(() => checkGuestStdout(Buffer.from(rows.map(JSON.stringify).join('\n') + '\n')));
  };
  mutate(rows => rows[6].parent_span_id = 'fabricated-parent');
  mutate(rows => rows[4].span_id = 'different-span');
  mutate(rows => rows[6].service = 'wrong-service');
  mutate(rows => rows[8].value = -1);
  mutate(rows => rows[2].body = '9223372036854775807');
  mutate(rows => rows[3].severity = 'DEBUG');
  mutate(rows => rows[7].duration_ns = -3);
  mutate(rows => rows[6].http_status = 200);
  mutate(rows => rows[8].secret = 'must-not-enter-telemetry');
});

test('oversize, malformed UTF-8, duplicate JSONL fields and empty stdout reject', () => {
  const capture = sampleCapture();
  expectDenied(() => checkGuestStdout(Buffer.alloc(1024 * 1024 + 1, 65)));
  expectDenied(() => checkGuestStdout(Buffer.from([0xff, 0xfe])));
  expectDenied(() => checkGuestStdout(Buffer.alloc(0)));
  expectDenied(() => checkGuestStdout(capture.subarray(0, capture.length - 1)));
  const text = capture.toString();
  expectDenied(() => checkGuestStdout(Buffer.from(
    text.replace('"signal":"log"', '"signal":"log","signal":"metric"'))));
});

test('indirect shell and Python invocation cannot gain receipt credit', () => {
  const capture = sampleCapture();
  const r = sampleReceipt(capture);
  for (const executable of ['/bin/sh', '/usr/bin/bash', '/usr/local/bin/python3', '/usr/bin/env']) {
    r.command_argv[0] = executable;
    expectDenied(() => verifyReceipt(r, capture));
  }
});

test('unknown receipt keys and wrong stdout JSONL schema reject', () => {
  const capture = sampleCapture();
  const r = sampleReceipt(capture);
  r.parityCertified = true;
  expectDenied(() => verifyReceipt(r, capture));
  const malformed = Buffer.from(capture.toString().replace('"oreslang-otel.v1"', '"OTLP"'));
  expectDenied(() => checkGuestStdout(malformed));
});
