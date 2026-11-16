import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, sep} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(await readFile(
  new URL('../contracts/susp-effect-alias-v1.json',import.meta.url),'utf8'));
test('canonical suspension alias contract is nonambiguous', () => {
  assert.equal(registry.schema,'atto.susp-effect-alias.v1');
  assert.equal(registry.canonical,'susp');
  assert.deepEqual(registry.aliases,['susp','suspends']);
  assert.ok(registry.forbidden_aliases.includes('#'));
  assert.ok(registry.effect_identity.includes('distinct'));
});
test('all required positive and negative fixtures exist and are nonempty',async() => {
  const ids = new Set();
  for (const c of registry.required_cases) {
    assert.ok(!ids.has(c.id),'duplicate case: '+c.id);
    ids.add(c.id);
    assert.ok(['pass','fail'].includes(c.kind));
    assert.ok(['frontend_parse','parse','compile','guest_jspsi'].includes(c.stage));
    if (c.kind === 'fail') assert.match(c.expected_error,/^E_[A-Z_]+$/);
    const full=resolve(root,c.path);
    assert.ok(full.startsWith(root+sep),'no escaping fixture path');
    const text=await readFile(full,'utf8');
    assert.ok(text.includes('fnc'),'fixture must declare a callable');
    assert.ok(text.trim().length>25);
  }
  assert.ok(ids.size>=8);
});
test('unverified backends cannot be presented as passing', () => {
  for (const [name,status] of Object.entries(registry.backend_status)) {
    if (name!=='rs-browser') assert.equal(status,'NOT_EXECUTED',name);
  }
  assert.match(registry.backend_status['rs-browser'],/^FOCUSED_/);
  assert.match(registry.focused_evidence.scope,/not been individually executed/);
  assert.ok(registry.focused_evidence.mirrored_source_test_blob_count>0);
});
