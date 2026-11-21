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
    control_plane_v1: 'control_generation12_slot20_v1'
  });
  for (const key of ['language_object_heap_is_not_JVM_or_CLR_heap', 'host_jvm_clr_gc_may_remain',
    'same_numeric_words_across_domains_are_not_authority', 'cross_repo_source_transfer_requires_effective_approval',
    'abi_tags_must_match_explicitly', 'actor_backend_abi_is_not_control_abi', 'host_test_does_not_prove_guest'])
    assert.equal(x.scope[key], true, 'mandatory explicit scope: ' + key);
  assert.deepEqual(x.scope.attributed_control_host_code,
    ['atto-lang/atto-source.net', 'atto-lang/atto-source.java', 'atto-lang/atto-source.llvm',
      'atto-lang/atto-source.js', 'atto-lang/atto-source.forge', 'atto-lang/atto-source.wasm']);
  const sources = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NOT_TESTED');
  const native = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NATIVE_HOST_TESTED_LOCAL');
  const codecs = x.backends.filter(y =>
    y.control_plane_source_status === 'SOURCE_COMMITTED_CODEC_LOCAL_NODE_ONLY' ||
    y.control_plane_source_status === 'SOURCE_COMMITTED_CODEC_LOCAL_NATIVE_ONLY');
  assert.deepEqual(sources.map(y => y.repo), ['atto-lang/atto-source.net', 'atto-lang/atto-source.java']);
  assert.deepEqual(native.map(y => y.repo), ['atto-lang/atto-source.llvm']);
  assert.deepEqual(codecs.map(y => y.repo), ['atto-lang/atto-source.js','atto-lang/atto-source.forge','atto-lang/atto-source.wasm']);
  assert.deepEqual([...sources, ...native, ...codecs].map(y => y.repo).sort(),
    [...x.scope.attributed_control_host_code].sort());
  for (const row of x.backends) {
    assert(abiOptions.has(row.actor_reference_abi_candidate), 'unrecognized actor ref encoding');
    assert.equal(row.control_plane_compiled_atto_guest, 'NOT_EXECUTED');
    const integration = row.repo === 'atto-lang/atto-source.java'
      ? ['JAVA_JVM_SPAWN_STOP_NATIVE_COUNTERS_SOURCE_AUTHORED_NOT_EXECUTED', 44]
      : row.repo === 'atto-lang/atto-source.net'
      ? ['NET_CLR_AND_NATIVEAOT_SPAWN_DISPATCH_STOP_NATIVE_COUNTERS_SOURCE_AUTHORED_NOT_EXECUTED', 48]
      : ['NO_EXECUTED_RUNTIME_NATIVE_ROOT_INTEGRATION_IN_THIS_AUDIT', null];
    assert.equal(row.runtime_native_root_integration, integration[0],
      'host runtime integration must not be mistaken for guest parity');
    assert.equal(row.runtime_root_native_reserved_bytes, integration[1],
      'control-plane quota must account for backend native alignment');
    assert.equal(row.runtime_integration_executed_steps, 0,
      'unadmitted source workflows provide no executed runtime steps');
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
      assert.equal(row.control_reference_abi_candidate, 'control_generation12_slot20_v1');
      assert.equal(row.candidate_stage, 'UNMANAGED_CONTROL_HOST_SOURCE');
      assert.equal(row.native_host_local_test, null);
      assert.equal(row.host_control_codec_test, null);
    } else if (native.includes(row)) {
      assert.equal(row.control_reference_abi_candidate, 'control_generation12_slot20_v1');
      assert.equal(row.candidate_stage, 'ACTOR_NATIVE_ARENA_HOST_SOURCE');
      const receipt = row.native_host_local_test;
      assert.equal(receipt.status, 'PASS_LOCAL_NATIVE_HOST_ONLY');
      assert.equal(receipt.compiled_atto_guest, 'NOT_EXECUTED');
      assert.equal(receipt.ci_on_current_head, 'NOT_EXECUTED');
      assert.equal(receipt.os_target, 'linux-x86_64');
      assert.deepEqual(receipt.source_blobs, {
        'ControlPlaneArena32.h': 'ae2188f51a1659426dbd8c7e94bc6e672525dfde',
        'ControlPlaneArena32.c': 'ff66f2be47a50373e88b7d4e66b4d35f396bc0c5',
        'control_plane_arena32_test.c': '195ad863104d48aaaf1a57d648760ca85e73887e'
      });
      assert.match(receipt.gcc_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.clang_sanitized_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.positive_host_pass_marker, /NO compiled Atto guest or zero-GC proof/);
      assert.equal(row.host_control_codec_test, null);
    } else if (codecs.includes(row)) {
      assert.equal(row.control_reference_abi_candidate, 'control_generation12_slot20_v1');
      assert.equal(row.native_host_local_test, null);
      const receipt = row.host_control_codec_test;
      assert.equal(receipt.actual_compiled_atto_guest, 'NOT_EXECUTED');
      if (row.repo.endsWith('.forge')) {
        assert.equal(row.control_plane_source_status, 'SOURCE_COMMITTED_CODEC_LOCAL_NATIVE_ONLY');
        assert.equal(receipt.local_execution, 'PASS_LOCAL_NATIVE_HOST_ONLY');
        assert.equal(receipt.tests_passed, 2);
        assert.deepEqual(receipt.source_blobs, {
          'runtime/ControlRef32CodecV1.hpp': '6c6e32aed6540233be306114dbb9abfddcee10c3',
          'tests/control_ref32_codec_v1_test.cpp': 'b351175cdc7e9e8d052eb889ad2c9f1978bb1115',
          'CMakeLists.txt': 'a0daf3f529ae5bad5d3f5811d754324cf70bd35e'
        });
        assert.deepEqual(receipt.toolchains,
          ['GCC 14.2.0 C++20 -O2 -Werror', 'Clang 17 C++20 -O1 ASan/UBSan']);
      } else {
        assert.equal(row.control_plane_source_status, 'SOURCE_COMMITTED_CODEC_LOCAL_NODE_ONLY');
        assert.equal(receipt.local_execution, 'PASS_LOCAL_NODE_HOST_ONLY');
        assert.equal(receipt.runtime, 'Node 22.16.0');
        assert.equal(receipt.tests_passed, 4);
        assert.deepEqual(receipt.source_blobs, {
          'src/control-ref32-v1.mjs': 'd9e7a30217b2fe5c17d6794aa40a7b26f7f4a311',
          'tests/control-ref32-v1.test.mjs': '474f5d7b4f0fc8142f497f0acdd4d050c17306b5'
        });
      }
    } else {
      assert.equal(row.control_reference_abi_candidate, null);
      assert.equal(row.control_plane_source_status, 'NO_CONTROL_GUEST_PROOF_IN_THIS_AUDIT');
      assert.equal(row.native_host_local_test, null);
      assert.equal(row.host_control_codec_test, null);
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

test('reject obsolete reversed bit-count control ABI identifier', () => {
  const invalid = structuredClone(baseline);
  invalid.references.control_plane_v1='control_generation20_slot12_v1';
  assert.throws(() => inspect(invalid));
});

test('new control codec receipts cannot promote guest parity or forge source blobs', () => {
  for (const backendIndex of [7,8,9]) {
    const wrong = structuredClone(baseline);
    wrong.backends[backendIndex].host_control_codec_test.actual_compiled_atto_guest = 'PASSED';
    assert.throws(() => inspect(wrong));
    const blob = structuredClone(baseline);
    const keys = Object.keys(blob.backends[backendIndex].host_control_codec_test.source_blobs);
    blob.backends[backendIndex].host_control_codec_test.source_blobs[keys[0]] = 'f'.repeat(40);
    assert.throws(() => inspect(blob));
  }
});

test('cannot forge java or dotnet runtime native-root execution or quota', () => {
  for (const repo of ['atto-lang/atto-source.java', 'atto-lang/atto-source.net']) {
    const forged = structuredClone(baseline);
    const row = forged.backends.find(x => x.repo === repo);
    row.runtime_native_root_integration = 'PASSED_COMPILED_ATTO_GUEST';
    assert.throws(() => inspect(forged));
    const fakeSteps = structuredClone(baseline);
    fakeSteps.backends.find(x => x.repo === repo).runtime_integration_executed_steps = 7;
    assert.throws(() => inspect(fakeSteps));
    const invalidQuota = structuredClone(baseline);
    invalidQuota.backends.find(x => x.repo === repo).runtime_root_native_reserved_bytes = 0;
    assert.throws(() => inspect(invalidQuota));
  }
});
