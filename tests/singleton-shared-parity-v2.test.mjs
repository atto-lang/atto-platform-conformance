import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../contracts/singleton-shared-parity-v2.json', import.meta.url), 'utf8');
const baseline = JSON.parse(raw);
const PRIMARY = ["java","llvm","net","wasm","forge"];
const EXTRA = ["js","rs","cranelift","hdl"];
const CASES = new Map([["singleton-key-module-namespace","required"],["singleton-identity-within-domain","required"],["singleton-distinct-tenants","required"],["immutable-recursive-snapshot","required"],["const-initialization-once","required"],["sticky-initializer-failure","required"],["initializer-cycle-rejected","deny"],["schema-change-without-migration-rejected","deny"],["mutable-alias-escape-rejected","deny"],["actor-private-state-implicit-sharing-rejected","deny"],["symbol-nominal-not-string","required"],["symbol-cross-isolate-pointer-equality-forbidden","deny"],["symbol-canonical-logical-id","required"],["symbol-untrusted-private-publish-rejected","deny"],["symbol-intern-budget","required"],["reader-reader-overlap","required"],["reader-writer-exclusion","required"],["writer-writer-exclusion","required"],["writer-barrier-fairness","required"],["nonparking-actor-carrier","required"],["runtime-minted-principal","required"],["grant-one-shot","required"],["wrong-tenant-denied","deny"],["stale-incarnation-denied","deny"],["ownership-transfer-quiescent","required"],["cancel-queued-admission","required"],["revoked-write-draft-never-published","required"],["writer-physical-callback-drain","required"],["no-await-under-critical","deny"],["no-guest-callback-under-lock","deny"],["stop-revokes-new-admission","required"],["stop-retains-live-physical-pins","required"],["native-reclamation-scrub-before-reuse","required"],["hot-reload-generation-fence","required"],["guest-executable-evidence-exact-head","required"],["host-only-not-guest-certified","required"]]);
function validate(x) {
  assert.deepEqual(Object.keys(x).sort(), [
    'actor_private_state','additional_backends','backends','cases','contract',
    'critical_rule','guest_promotion','logical_scope','primary_backends',
    'status','symbol_rule','version'].sort());
  assert.equal(x.contract, 'atto-singleton-shared-symbol-parity-v2');
  assert.equal(x.version, 2);
  assert.equal(x.status, 'draft-requirements-not-runtime-certification');
  assert.deepEqual(x.primary_backends, PRIMARY);
  assert.deepEqual(x.additional_backends, EXTRA);
  assert.deepEqual(Object.keys(x.backends), [...PRIMARY,...EXTRA]);
  assert.equal(x.cases.length, CASES.size);
  const found = new Set();
  for (const c of x.cases) {
    assert.deepEqual(Object.keys(c).sort(), ['expect','id']);
    assert.ok(!found.has(c.id), 'duplicate case '+c.id);
    found.add(c.id);
    assert.equal(c.expect, CASES.get(c.id), 'changed case '+c.id);
  }
  assert.deepEqual([...found].sort(), [...CASES.keys()].sort());
  assert.match(x.actor_private_state, /never implicitly shared/);
  assert.match(x.guest_promotion, /deny-without/);
  for (const [name,entry] of Object.entries(x.backends)) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'tier','guest_singleton','guest_shared_region','compiled_guest_proof',
      'native_isolate_proof','default_branch_parity','required_evidence'].sort());
    assert.equal(entry.tier, PRIMARY.includes(name) ? 'primary' : 'additional');
    assert.equal(entry.guest_singleton, 'not-certified');
    assert.equal(entry.guest_shared_region, 'not-certified');
    assert.equal(entry.compiled_guest_proof, 'not-executed');
    assert.equal(entry.native_isolate_proof, 'not-executed');
    assert.equal(entry.default_branch_parity, 'unverified');
    assert.deepEqual(entry.required_evidence, [
      'exact-git-sha','stepful-CI','compiled-guest','negative-admission']);
  }
  return true;
}
const clone = () => structuredClone(baseline);
test('nine backend requirements validate without fictional guest certification',()=>assert.ok(validate(clone())));
for (const name of [...PRIMARY,...EXTRA]) {
  test(name+': forged guest-pass receipt is rejected',()=>{
    const m=clone();m.backends[name].compiled_guest_proof='passed';assert.throws(()=>validate(m));
  });
  test(name+': fake default-branch parity is rejected',()=>{
    const m=clone();m.backends[name].default_branch_parity='passed';assert.throws(()=>validate(m));
  });
}
for (const [id] of CASES) {
  test('mutation '+id+' cannot silently promote requirements',()=>{
    const m=clone();m.cases.find(x=>x.id===id).expect='guest-executable';assert.throws(()=>validate(m));
  });
}
test('duplicate requirements fail closed',()=>{const m=clone();m.cases[0].id=m.cases[1].id;assert.throws(()=>validate(m));});
test('unknown backend rejected',()=>{const m=clone();m.backends.unknown=m.backends.java;assert.throws(()=>validate(m));});
test('removed backend rejected',()=>{const m=clone();delete m.backends.hdl;assert.throws(()=>validate(m));});
test('critical isolation cannot be promoted by deleting wording',()=>{const m=clone();m.actor_private_state='shared';assert.throws(()=>validate(m));});
