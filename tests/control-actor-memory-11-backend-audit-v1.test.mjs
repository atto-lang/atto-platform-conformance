import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync(new URL('../contracts/control-actor-memory-11-backend-audit-v1.json', import.meta.url), 'utf8'));
const existing = JSON.parse(readFileSync(new URL('../contracts/atto-source-repository-parity-audit-v1.json', import.meta.url), 'utf8'));
const sha = /^[0-9a-f]{40}$/;
const expected = existing.source_repositories.map(x => x.repo);
const abiOptions = new Set([null, 'offset8_plus_one', 'generation20_slot12', 'generation16_slot16']);
function inspect(x) {
  assert.equal(x.schema, 'atto.control-actor-memory-11-backend-audit.v1');
  assert.equal(x.status, 'SOURCE_ONLY_NO_GUEST_PARITY');
  assert.equal(x.backend_count, 11);
  assert.deepEqual(x.backends.map(y => y.repo), expected, 'all canonical Atto source repos in exact order');
  assert.deepEqual(x.references, {
    actor_offset: 'offset8_plus_one',
    java_actor_host_slot: 'generation20_slot12',
    net_actor_guest_slot: 'generation16_slot16',
    control_plane_v1: 'control_generation20_slot12_v1'
  });
  for (const key of ['language_object_heap_is_not_JVM_or_CLR_heap', 'host_jvm_clr_gc_may_remain',
    'same_numeric_words_across_domains_are_not_authority', 'cross_repo_source_transfer_requires_effective_approval',
    'abi_tags_must_match_explicitly', 'actor_backend_abi_is_not_control_abi', 'host_test_does_not_prove_guest'])
    assert.equal(x.scope[key], true, 'mandatory explicit scope: ' + key);
  assert.deepEqual(x.scope.attributed_control_host_code,
    ['atto-lang/atto-source.net', 'atto-lang/atto-source.java', 'atto-lang/atto-source.llvm']);
  const sources = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NOT_TESTED');
  const native = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NATIVE_HOST_TESTED_LOCAL');
  assert.deepEqual(sources.map(y => y.repo), ['atto-lang/atto-source.net', 'atto-lang/atto-source.java']);
  assert.deepEqual(native.map(y => y.repo), ['atto-lang/atto-source.llvm']);
  assert.deepEqual([...sources, ...native].map(y => y.repo).sort(),
    [...x.scope.attributed_control_host_code].sort());
  for (const row of x.backends) {
    assert(abiOptions.has(row.actor_reference_abi_candidate), 'unrecognized actor ref encoding');
    assert.equal(row.control_plane_compiled_atto_guest, 'NOT_EXECUTED');
    assert.equal(row.managed_hotpath_allocation_measurement, 'NOT_EXECUTED');
    assert.equal(row.deterministic_stop_quiescence_integration, 'NOT_EXECUTED');
    assert.equal(row.guest_zero_tracing_gc, 'NOT_VERIFIED');
    assert.equal(row.host_managed_allocation_probe,
      sources.includes(row) ? 'SOURCE_AUTHORED_NOT_EXECUTED' : 'NO_HOST_PROBE_VERIFIED_IN_THIS_AUDIT');
    assert.equal(row.full_process_zero_gc_claim, false);
    if (row.existing_pr === null) assert.equal(row.observed_candidate_pr_head_sha, null);
    else {
      assert.equal(row.existing_pr.startsWith('https://github.com/'+row.repo+'/pull/'), true);
      assert.match(row.observed_candidate_pr_head_sha, sha);
    }
    if (sources.includes(row)) {
      assert.equal(row.control_reference_abi_candidate, 'control_generation20_slot12_v1');
      assert.equal(row.candidate_stage, 'UNMANAGED_CONTROL_HOST_SOURCE');
      assert.equal(row.native_host_local_test, null);
    } else if (native.includes(row)) {
      assert.equal(row.control_reference_abi_candidate, 'control_generation20_slot12_v1');
      assert.equal(row.candidate_stage, 'ACTOR_NATIVE_ARENA_HOST_SOURCE');
      const receipt = row.native_host_local_test;
      assert.equal(receipt.status, 'PASS_LOCAL_NATIVE_HOST_ONLY');
      assert.equal(receipt.compiled_atto_guest, 'NOT_EXECUTED');
      assert.equal(receipt.ci_on_current_head, 'NOT_EXECUTED');
      assert.equal(receipt.os_target, 'linux-x86_64');
      assert.deepEqual(receipt.source_blobs, {
        'ControlPlaneArena32.h': '64eabc65b9ce917d5f3085a42e8e2c9f3f2213c6',
        'ControlPlaneArena32.c': 'd4e99998d545c634279d1620f67fc57bfbb3e5de',
        'control_plane_arena32_test.c': '598591e49a5665fef25e01366af20d35ac35f649'
      });
      assert.match(receipt.gcc_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.clang_sanitized_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.positive_host_pass_marker, /NO compiled Atto guest or zero-GC proof/);
    } else {
      assert.equal(row.control_reference_abi_candidate, null);
      assert.equal(row.control_plane_source_status, 'NO_CONTROL_GUEST_PROOF_IN_THIS_AUDIT');
      assert.equal(row.native_host_local_test, null);
    }
  }
}
test('all 11 compiler targets have honest memory status and versioned ABIs', () => inspect(baseline));
test('cannot invent a compiled guest or zero managed allocation proof', () => {
  for (const key of ['control_plane_compiled_atto_guest', 'managed_hotpath_allocation_measurement',
    'deterministic_stop_quiescence_integration']) {
    const forged = structuredClone(baseline); forged.backends[3][key] = 'PASSED';
    assert.throws(() => inspect(forged));
  }
  const gc = structuredClone(baseline); gc.backends[1].full_process_zero_gc_claim = true;
  assert.throws(() => inspect(gc));
});
test('cannot confuse Java/NET actor ABIs with shared control ABI', () => {
  const x = structuredClone(baseline); x.backends[1].control_reference_abi_candidate = 'generation16_slot16';
  assert.throws(() => inspect(x));
  const y = structuredClone(baseline); y.references.java_actor_host_slot='offset8_plus_one';
  assert.throws(() => inspect(y));
});
test('cannot omit self-hosted, realtime or a non-primary backend', () => {
  const x = structuredClone(baseline); x.backends.pop();
  assert.throws(() => inspect(x));
  const y = structuredClone(baseline); y.backends[0].repo = y.backends[1].repo;
  assert.throws(() => inspect(y));
});
test('cannot forge a source head or classify unproved code as guest implementation', () => {
  const x = structuredClone(baseline); x.backends[3].observed_candidate_pr_head_sha='main';
  assert.throws(() => inspect(x));
  const y = structuredClone(baseline); y.backends[6].control_plane_source_status = 'SOURCE_COMMITTED_NOT_TESTED';
  assert.throws(() => inspect(y));
});

test('LLVM source-pinned local native host sanitizer receipts do not promote guests', () => {
  const changed = structuredClone(baseline);
  changed.backends[6].native_host_local_test.source_blobs['ControlPlaneArena32.c']='0'.repeat(40);
  assert.throws(() => inspect(changed));
  const mislabel = structuredClone(baseline);
  mislabel.backends[6].native_host_local_test.compiled_atto_guest='PASSED';
  assert.throws(() => inspect(mislabel));
});
