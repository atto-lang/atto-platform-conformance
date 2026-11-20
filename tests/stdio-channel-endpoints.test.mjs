import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8');
const c = JSON.parse(text('contracts/stdio-channel-endpoints-v1.json'));

test('stdio target does not claim unexecuted guest parity', () => {
  assert.equal(c.schema, 'atto.stdio.channel.endpoints.v1');
  assert.equal(c.status, 'TARGET_NOT_EXECUTED');
  assert.equal(c.data_contract.stdin_outcome, 'Result<Option<string>,IoError>');
  assert.equal(c.data_contract.output_outcome, 'Result<void,IoError>');
  assert.equal(c.data_contract.carrier_threads_may_park, false);
  assert.equal(c.data_contract.active_stdin_consumers, 1);
  assert.equal(c.data_contract.tenant_stdio_ambient, false);
  assert.deepEqual(new Set(Object.values(c.backend_status)), new Set(['NOT_EXECUTED']));
  assert.equal(Object.keys(c.backend_status).length, 11);
});

test('all source fixtures exist; negative diagnostics remain explicit', () => {
  const seen = new Set();
  for (const item of c.required_cases) {
    assert.ok(!seen.has(item.id), 'duplicate case: ' + item.id);
    seen.add(item.id);
    const source = text(item.path);
    assert.match(source, /pub /);
    if (item.kind === 'compile-fail') {
      assert.ok(source.includes('// expect-error: ' + item.expected_error));
      assert.equal(item.no_guest_artifact, true);
    }
    if (item.kind === 'compile-or-runtime-deny') {
      assert.ok(source.includes('// expect-error: ' + item.expected_error));
      assert.equal(item.no_guest_artifact_or_input_consumed, true);
    }
  }
});

test('checked echo covers success, empty item, EOF, encoding and framing', () => {
  const entry = c.required_cases.find(x => x.id === 'checked_echo');
  assert.equal(entry.kind, 'guest-pass');
  assert.deepEqual(entry.runs.map(x => x.id),
    ['one_line','empty_line','eof','unterminated','crlf','unicode','nul']);
  assert.equal(entry.runs[0].stdout, 'Echo the next input item:hello');
  assert.equal(entry.runs[2].exit, 11);
  assert.equal(entry.runs[2].stderr, '');
  assert.equal(entry.runs[5].stdout, 'Echo the next input item:é💡');
  assert.equal(entry.runs[6].stdout, 'Echo the next input item:a' + String.fromCharCode(0) + 'b');
  const source = text(entry.path);
  assert.match(source, /readch input/);
  assert.match(source, /writech output, item/);
  assert.match(source, /on Ok\(None\)/);
  assert.match(source, /on Err\(_\)/);
});

test('unsafe preview is required to be rejected, not silently unwrapped', () => {
  const source = text('fixtures/stdio-channel/fail/unchecked_read_payload.atto');
  assert.match(source, /val item = readch input/);
  assert.match(source, /writech output, item/);
  assert.ok(c.evidence_rule.includes('actual compiled .atto guest'));
});
