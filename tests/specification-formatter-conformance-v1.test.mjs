// Host-only manifest validation. These are prospective cases, not executed guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const c = JSON.parse(readFileSync(new URL('../contracts/specification-formatter-conformance-v1.json', import.meta.url),'utf8'));
test('formatter conformance contract pins spec and explicit nonexecution status', () => {
  assert.equal(c.schema,'atto.specification-formatter-conformance.v1');
  assert.equal(c.schema_version,1);
  assert.match(c.authority.commit,/^[a-f0-9]{40}$/);
  assert.match(c.authority.registry_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(c.authority.repository,'atto-lang/atto-spec');
  assert.equal(c.cases.length,8);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
  assert.deepEqual(c.formatter_consumers,['atto-lang/atto-format','ores-truffle-oreslang/oreslang-format']);
  assert.ok(c.backends.length>=7);
  assert.deepEqual(c.permitted_states,['passed','failed','unsupported','not_executed']);
  for (const testcase of c.cases) {
    assert.match(testcase.id,/^fmt-[a-z0-9-]+$/);
    assert.ok(testcase.rules.length>0 && testcase.rules.every(x=>/^ATTO-[A-Z]+-[0-9]{3}$/.test(x)));
    assert.ok(['accept','reject','contextual'].includes(testcase.expect));
    assert.ok(testcase.source.length>10);
    assert.equal(testcase.status,'not_executed');
    for (const b of [...c.backends,...c.formatter_consumers]) assert.equal(testcase.evidence[b],'not_executed',testcase.id+' '+b);
    assert.equal(Object.keys(testcase.evidence).length,c.backends.length+c.formatter_consumers.length);
  }
});
test('negative namespace vectors and ownership distinctions are required', () => {
  assert.ok(c.cases.some(x=>x.id==='fmt-namespace-invalid-order' && x.expect==='reject'));
  assert.ok(c.cases.some(x=>x.id==='fmt-namespace-duplicate' && x.expect==='reject'));
  assert.ok(c.cases.some(x=>x.source.includes('copy! ') && x.source.includes('copy!! ')));
  assert.ok(c.cases.some(x=>x.source.includes('os.read_env')));
  assert.ok(c.cases.some(x=>x.source.includes('lifetime!')));
});
