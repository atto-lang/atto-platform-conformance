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

test('checked echo and unary << / readch aliases preserve checked nested result', () => {
  const entry = c.required_cases.find(x => x.id === 'checked_echo');
  const alias = c.required_cases.find(x => x.id === 'checked_echo_readch_alias');
  assert.equal(entry.kind, 'guest-pass');
  assert.equal(alias.kind, 'guest-pass');
  assert.equal(alias.equivalent_to, 'checked_echo');
  assert.deepEqual(entry.runs, alias.runs);
  assert.deepEqual(entry.runs.map(x => x.id),
    ['one_line','empty_line','eof','unterminated','crlf','unicode','nul']);
  assert.equal(entry.runs[0].stdout, 'Echo the next input item:hello');
  assert.equal(entry.runs[2].exit, 11);
  assert.equal(entry.runs[2].stderr, '');
  assert.equal(entry.runs[5].stdout, 'Echo the next input item:é💡');
  assert.equal(entry.runs[6].stdout, 'Echo the next input item:a' + String.fromCharCode(0) + 'b');
  const source = text(entry.path);
  const equivalent = text(alias.path);
  assert.match(source, /on Ok\(_\) -> match << input over/);
  assert.match(equivalent, /on Ok\(_\) -> match readch input over/);
  for(const sample of [source,equivalent]) {
    assert.match(sample,/on Ok\(line\) -> match line over/);
    assert.match(sample,/on Some\(item\) -> match writech output, item/);
    assert.match(sample,/on None -> 11/);
    assert.match(sample,/on Err\(_\) -> 14/);
  }
  assert.deepEqual(c.data_contract.checked_read_spellings,['readch input','<< input']);
  assert.deepEqual(c.data_contract.checked_success_discard,['on Ok','on Ok(_)']);
});

test('unsafe preview is required to be rejected, not silently unwrapped', () => {
  const source = text('fixtures/stdio-channel/fail/unchecked_read_payload.atto');
  assert.match(source, /val item = readch input/);
  assert.match(source, /writech output, item/);
  assert.ok(c.evidence_rule.includes('actual compiled .atto guest'));
});

test('nominal on is ADT fixtures are cross-backend targets, not parser-only PASS', () => {
  const variants=c.required_cases.filter(item=>item.id.startsWith('checked_echo_is_variants'));
  assert.deepEqual(variants.map(x=>x.id),
    ['checked_echo_is_variants','checked_echo_is_variants_readch']);
  const reference=c.required_cases.find(x=>x.id==='checked_echo');
  for(const item of variants) {
    assert.equal(item.kind,'guest-pass');
    assert.equal(item.equivalent_to,'checked_echo');
    assert.deepEqual(item.runs,reference.runs);
    const source=text(item.path);
    assert.match(source,/on is Ok<_> -> match/);
    assert.match(source,/on is Ok<line> -> match line over/);
    assert.match(source,/on is Some<item> -> match writech output, item over/);
    assert.match(source,/on is Err<error>/);
    assert.match(source,/on is None -> 11/);
  }
  assert.match(text(variants[0].path),/match << input over/);
  assert.match(text(variants[1].path),/match readch input over/);
  const standalone=c.required_cases.find(x=>x.id==='stdio_is_pattern_fallback');
  assert.equal(standalone.kind,'source-compile-pass');
  assert.match(text(standalone.path),/on is Ok<_> -> match << input over/);
  assert.match(text(standalone.path),/on is Some<item> -> item/);
  assert.match(text(standalone.path),/on None -> ""/);
  assert.deepEqual(c.data_contract.is_adt_pattern_equivalences,{
    'on is Ok<_>':'on Ok(_)',
    'on is Ok<line>':'on Ok(line)',
    'on is Some<item>':'on Some(item)',
    'on is Err<error>':'on Err(error)',
    'on is None':'on None'
  });
  assert.equal(Object.keys(c.backend_status).length,11);
  assert.ok(Object.values(c.backend_status).every(v=>v==='NOT_EXECUTED'));
});

test('unsafe dynamic extractor and wrong family/arity cannot pass a compile gate', () => {
  const invalid=[
    ['is_unknown_extractor','E_PATTERN'],
    ['is_none_payload','E_ARITY'],
    ['is_void_ok_bound','E_ARITY'],
    ['is_missing_ok_payload','E_ARITY'],
    ['is_wrong_variant_family','E_TYPE'],
    ['is_nested_extractor','E_SYNTAX'],
    ['is_multi_payload','E_SYNTAX'],
    ['is_duplicate_arm','E_MATCH'],
  ];
  for(const [id,code] of invalid) {
    const spec=c.required_cases.find(x=>x.id===id);
    assert.ok(spec,id+' is missing from the portable manifest');
    assert.equal(spec.kind,'compile-fail');
    assert.equal(spec.expected_error,code);
    assert.equal(spec.no_guest_artifact,true);
    assert.match(text(spec.path),new RegExp('expect-error: '+code));
    assert.match(text(spec.path),/pub suspends fnc main/);
  }
  assert.ok(c.evidence_rule.includes('actual guest execution'));
});
