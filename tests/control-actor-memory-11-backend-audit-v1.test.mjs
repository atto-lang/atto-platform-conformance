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
    ['atto-lang/atto-source.net', 'atto-lang/atto-source.java', 'atto-lang/atto-source.rs',
      'atto-lang/atto-source.llvm', 'atto-lang/atto-source.js', 'atto-lang/atto-source.forge', 'atto-lang/atto-source.wasm']);
  const sources = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NOT_TESTED');
  const native = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_NATIVE_HOST_TESTED_LOCAL');
  const codecs = x.backends.filter(y =>
    y.control_plane_source_status === 'SOURCE_COMMITTED_CODEC_LOCAL_NODE_ONLY' ||
    y.control_plane_source_status === 'SOURCE_COMMITTED_CODEC_LOCAL_NATIVE_ONLY');
  assert.deepEqual(sources.map(y => y.repo), ['atto-lang/atto-source.net', 'atto-lang/atto-source.java']);
  assert.deepEqual(native.map(y => y.repo), ['atto-lang/atto-source.llvm']);
  const rust = x.backends.filter(y => y.control_plane_source_status === 'SOURCE_COMMITTED_CODEC_UNTESTED_RUST');
  assert.deepEqual(rust.map(y => y.repo), ['atto-lang/atto-source.rs']);
  assert.deepEqual(codecs.map(y => y.repo), ['atto-lang/atto-source.js','atto-lang/atto-source.forge','atto-lang/atto-source.wasm']);
  assert.deepEqual([...sources, ...rust, ...native, ...codecs].map(y => y.repo).sort(),
    [...x.scope.attributed_control_host_code].sort());
  for (const row of x.backends) {
    assert(abiOptions.has(row.actor_reference_abi_candidate), 'unrecognized actor ref encoding');
    assert.equal(row.control_plane_compiled_atto_guest, 'NOT_EXECUTED');
    // A host scalar or runtime-root snapshot is never compiled .atto i128.
    const scalar = row.control_i128;
    assert.equal(scalar.compiled_atto_guest, 'NOT_EXECUTED');
    assert.equal(scalar.little_endian_low_64_hex, '0123456789abcdef');
    assert.equal(scalar.little_endian_high_64_hex, 'fedcba9876543210');
    const expectedI128 = row.repo.endsWith('.java')
      ? ['SOURCE_AUTHORED_JDK25_NOT_EXECUTED', '198c87ca8b6ab63afe112535c398b0a07ba2cfd1', false]
      : row.repo.endsWith('.net')
      ? ['SOURCE_AUTHORED_CLR_NATIVEAOT_NOT_EXECUTED', '90f52001ebca0fbc6055d55c0edde013c9da8f2c', false]
      : row.repo.endsWith('.llvm')
      ? ['PASS_LOCAL_GCC_CLANG_HOST_ONLY', '3afe81a79d6ecd8ef2a5a0ae1e00a3e4a4167d5d', true]
      : ['NOT_IMPLEMENTED_OR_UNVERIFIED', null, false];
    assert.equal(scalar.status, expectedI128[0]);
    assert.equal(scalar.source_test_blob, expectedI128[1]);
    assert.equal(scalar.host_i128_test_executed, expectedI128[2]);
    assert.equal(scalar.coherent_under_concurrent_host_access,
      expectedI128[1] === null ? null : true);
    assert.equal(scalar.host_gc_zero_bytes_on_warm_snapshot,
      row.repo.endsWith('.llvm') ? 'NOT_APPLICABLE_NATIVE_HOST' : 'NOT_EXECUTED');
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
    const pinnedRootSource = row.repo === 'atto-lang/atto-source.java' ? {
      'src/main/java/dev/oreslang/runtime/ActorRuntime.java': '4706147ed5a801d98f4361eec12396577bf93753',
      'src/main/java/dev/oreslang/runtime/ControlPlaneArena32.java': 'c533d5170c663988dc5205cc092265c731c47df9',
      'src/test/java/dev/oreslang/runtime/ActorRuntimeNativeControlCountersTest.java': '66fd8de6c4dc05d892ce949e26d27fa693eba63a',
      '.github/workflows/control-plane-ref32-ffm.yml': '2b19400d68a87ffcee17ab642448ac26d001d058'
    } : row.repo === 'atto-lang/atto-source.net' ? {
      'runtime/Ores.Net.Runtime/ActorRuntime.cs': 'fc923e24874d87e879722992f3b4e889e9f1979f',
      'runtime/Ores.Net.Runtime/ControlPlaneArena32.cs': 'acd64fe2106b0f44cdc1b2ebbc28097a229e601a',
      'verification/Ores.Net.Tests/ActorControlDirectoryIntegrationSelfTest.cs': '76c6022efc12545a1b07fdab817db3c8706344b0',
      'verification/Ores.Net.ControlRuntimeProbe/ControlRuntimeProbe.csproj': '691589168e8d02d58a462a9f25aa7a8303920d25',
      '.github/workflows/control-plane-ref32-nativeaot.yml': 'd95b0c1ca86def972f1e837fdd5f049860bd9f49'
    } : null;
    assert.deepEqual(row.runtime_native_root_source_blobs, pinnedRootSource,
      'source-only runtime integration evidence must retain exact immutable Git blob identities');
    assert.equal(row.managed_hotpath_allocation_measurement, 'NOT_EXECUTED');
    assert.equal(row.deterministic_stop_quiescence_integration, 'NOT_EXECUTED');
    assert.equal(row.guest_zero_tracing_gc, 'NOT_VERIFIED');
    assert.equal(row.host_managed_allocation_probe,
      sources.includes(row) ? 'SOURCE_AUTHORED_NOT_EXECUTED' : 'NO_HOST_PROBE_VERIFIED_IN_THIS_AUDIT');
    assert.equal(row.full_process_zero_gc_claim, false);
    if (row.repo.endsWith('.java') || row.repo.endsWith('.net')) {
      assert.deepEqual(row.issuer_saturation_receipt, {
        status: 'SOURCE_AUTHORED_NOT_EXECUTED',
        sequence: 'MONOTONE_SATURATING_CAS_U32',
        test_cases: ['first_issuer', 'last_issuer', 'exhausted_uint32', 'signed_overflow'],
        compiled_guest: 'NOT_EXECUTED'
      });
    } else {
      assert.equal(row.issuer_saturation_receipt, undefined);
    }
    if (row.repo.endsWith('.net')) {
      assert.deepEqual(row.native_scrub_receipt, {
        status: 'SOURCE_AUTHORED_NOT_EXECUTED',
        api: 'System.Security.Cryptography.CryptographicOperations.ZeroMemory',
        scopes: ['dropped_record', 'full_dispose_records', 'full_dispose_padded_metadata'],
        native_aot_test: 'NOT_EXECUTED'
      });
    } else {
      assert.equal(row.native_scrub_receipt, undefined);
    }
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
        'ControlPlaneArena32.h': 'c2cd3e1331ff8d328c024995efa2bae673122187',
        'ControlPlaneArena32.c': '7f0fe65ac32f207db88f2af0043553e74f23f37f',
        'control_plane_arena32_test.c': '3afe81a79d6ecd8ef2a5a0ae1e00a3e4a4167d5d'
      });
      assert.match(receipt.gcc_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.clang_sanitized_binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(receipt.positive_host_pass_marker, /NO compiled Atto guest or zero-GC proof/);
      assert.deepEqual(receipt.concurrent_i128_pair_test, {
        writer_iterations: 32768, reader_iterations: 32768,
        compiler_runs: { gcc_optimized: 1, clang_asan_ubsan: 1 },
        verdict: 'PASS_LOCAL_HOST_ONLY', live_guest_compiled: false
      });
      assert.deepEqual(receipt.issuer_saturation_receipt, {
        verdict: 'PASS_LOCAL_NATIVE_HOST_ONLY',
        boundary_cases: ['initial_issuer_zero', 'one_below_UINT32_MAX', 'at_UINT32_MAX',
          'UINT64_MAX_minus_one', 'UINT64_MAX', 'null_output'],
        non_reused_after_overflow: true,
        compiler_runs: { gcc_optimized: 5, clang_asan_ubsan: 5 },
        source_compiled_atto_guest: 'NOT_EXECUTED'
      });
      assert.deepEqual(receipt.concurrent_carrier_test, {
        threads: 4, iterations_per_thread: 1024,
        passed: 'PASS_LOCAL_HOST_SANITIZERS_ONLY',
        source_guest_compilation: 'NOT_EXECUTED'
      });
      assert.equal(row.host_control_codec_test, null);
    } else if (rust.includes(row)) {
      assert.equal(row.control_reference_abi_candidate, 'control_generation12_slot20_v1');
      assert.equal(row.candidate_stage, 'ACTOR_REF32_LAYOUT_SOURCE');
      assert.equal(row.native_host_local_test, null);
      assert.deepEqual(row.host_control_codec_test, {
        source_blobs: {
          'src/control_ref32.rs':'aef0b2f1e23fc9080ac67f53297b0abcdd5201bb',
          'src/lib.rs':'fcdb3f6da35dd79aa0fd0111ce233687d6b606c0'
        },
        local_execution: 'NOT_EXECUTED',
        rust_tests_authored: 3,
        actual_compiled_atto_guest: 'NOT_EXECUTED'
      });
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

test('Rust control codec SHA pin and unexecuted test status cannot be forged', () => {
  const claim = structuredClone(baseline);
  claim.backends[5].host_control_codec_test.local_execution = 'PASSED';
  assert.throws(() => inspect(claim));
  const swapped = structuredClone(baseline);
  swapped.backends[5].host_control_codec_test.source_blobs['src/control_ref32.rs'] = '1'.repeat(40);
  assert.throws(() => inspect(swapped));
});

test('native root source blob mismatch or foreign backend source claim is rejected', () => {
  const changed = structuredClone(baseline);
  changed.backends.find(x => x.repo.endsWith('.net')).runtime_native_root_source_blobs[
    'runtime/Ores.Net.Runtime/ControlPlaneArena32.cs'] = '0'.repeat(40);
  assert.throws(() => inspect(changed));
  const invented = structuredClone(baseline);
  invented.backends.find(x => x.repo.endsWith('.llvm')).runtime_native_root_source_blobs = {};
  assert.throws(() => inspect(invented));
});

test('cannot promote host i128 writes, fabricate zero CLR allocation, or forge 128-bit fixture SHA', () => {
  for (const suffix of ['.java', '.net', '.llvm']) {
    const idx = baseline.backends.findIndex(row => row.repo.endsWith(suffix));
    const fakeGuest = structuredClone(baseline);
    fakeGuest.backends[idx].control_i128.compiled_atto_guest = 'PASS';
    assert.throws(() => inspect(fakeGuest));
    const fakeExec = structuredClone(baseline);
    fakeExec.backends[idx].control_i128.host_i128_test_executed = suffix === '.llvm' ? false : true;
    assert.throws(() => inspect(fakeExec));
    const fakeSha = structuredClone(baseline);
    fakeSha.backends[idx].control_i128.source_test_blob = 'f'.repeat(40);
    assert.throws(() => inspect(fakeSha));
    const fakeGc = structuredClone(baseline);
    fakeGc.backends[idx].control_i128.host_gc_zero_bytes_on_warm_snapshot = 'PASS';
    assert.throws(() => inspect(fakeGc));
  }
});

test('issuer exhaustion and native scrub evidence cannot be forged', () => {
  const promote = structuredClone(baseline);
  promote.backends.find(row => row.repo.endsWith('.llvm'))
    .native_host_local_test.issuer_saturation_receipt.source_compiled_atto_guest = 'PASSED';
  assert.throws(() => inspect(promote));
  const rewind = structuredClone(baseline);
  rewind.backends.find(row => row.repo.endsWith('.llvm'))
    .native_host_local_test.issuer_saturation_receipt.non_reused_after_overflow = false;
  assert.throws(() => inspect(rewind));
  const claim = structuredClone(baseline);
  claim.backends.find(row => row.repo.endsWith('.net')).native_scrub_receipt.native_aot_test = 'PASSED';
  assert.throws(() => inspect(claim));
  const drop = structuredClone(baseline);
  drop.backends.find(row => row.repo.endsWith('.net')).native_scrub_receipt.scopes.pop();
  assert.throws(() => inspect(drop));
});

test('cannot forge Java or NET issuer saturation or compiled guest receipts', () => {
  for (const backend of ['.java','.net']) {
    const index = baseline.backends.findIndex(x => x.repo.endsWith(backend));
    const promoted = structuredClone(baseline);
    promoted.backends[index].issuer_saturation_receipt.compiled_guest = 'PASSED';
    assert.throws(() => inspect(promoted));
    const backward = structuredClone(baseline);
    backward.backends[index].issuer_saturation_receipt.sequence = 'WRAPPING';
    assert.throws(() => inspect(backward));
    const dropped = structuredClone(baseline);
    dropped.backends[index].issuer_saturation_receipt.test_cases.pop();
    assert.throws(() => inspect(dropped));
  }
});
