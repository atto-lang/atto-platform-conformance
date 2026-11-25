import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('contracts/actor-attached-state-v1.json', root), 'utf8'));
const read = path => readFileSync(new URL(path, root), 'utf8');
test('portable actor state contract has complete negative/positive case coverage', () => {
  assert.equal(registry.schema, 'atto.actor.attached-state.lifecycle.v1');
  assert.equal(registry.status, 'TARGET_NOT_EXECUTED');
  assert.equal(registry.required_cases.length, 13);
  assert.equal(new Set(registry.required_cases.map(x => x.id)).size, 13);
  assert.deepEqual(new Set(Object.values(registry.backend_status)),new Set(['NOT_EXECUTED']));
  assert.equal(Object.keys(registry.backend_status).length, 11);
  for (const entry of registry.required_cases) {
    assert.equal(entry.evidence, 'NOT_EXECUTED');
    const source = read(entry.path);
    assert.ok(source.startsWith('// TARGET'), entry.path);
    assert.match(source, /define (?:actor|state on actor|class)/,entry.path);
    assert.match(source, /pub fnc main\(\): int/,entry.path);
  }
});
test('inline and attached Counter preserve the intended critical and effect contract', () => {
  const inline = read('fixtures/actor-attached-state-v1/pass/inline_counter.atto');
  const attached = read('fixtures/actor-attached-state-v1/pass/attached_counter.atto');
  assert.match(inline,/state\s*\{\s*let int count;/);
  assert.match(attached,/define state on actor Counter as\s*\{\s*let int count;/);
  assert.doesNotMatch(attached,/state\s*\{\s*let int count;/);
  for (const source of [inline,attached]) {
    assert.match(source,/on_start\(\): void using state\.write/);
    assert.match(source,/receive\(ActorMail<int> mail\): void using state\.read, state\.write/);
    assert.match(source,/self\.handle_state\(critical-write/);
    assert.match(source,/self\.handle_state\(critical-read/);
    assert.match(source,/counter\.send\(1\)/);
  }
});
test('rejection probes prohibit state access escapes and do not masquerade as compiled tests', () => {
  const neg = registry.required_cases.filter(x => x.kind === 'fail');
  assert.equal(neg.length, 10);
  for (const x of neg) assert.equal(x.expected,'COMPILE_REJECT_WITH_NO_GUEST_ARTIFACT');
  assert.match(registry.evidence_rule,/guest artifact/);
  assert.match(registry.caveat,/does not guarantee stdout/);
});
