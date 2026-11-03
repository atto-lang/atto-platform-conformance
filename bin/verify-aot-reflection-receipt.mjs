#!/usr/bin/env node
// Structural checks ONLY. This tool cannot authenticate CI, a compiler, or a binary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha40 = /^[0-9a-f]{40}$/i;
const sha256 = /^[0-9a-f]{64}$/i;
const expectedStage = {
  'compile-and-run': 'guest-aot',
  'runtime-deny': 'guest-aot',
  'compile-reject': 'compiler-rejection',
  'artifact-inspection': 'artifact-audit',
  'build-metadata': 'build-audit'
};

// Pinned by independently reviewed v1 source contract: dropping a rejection or
// substituting a weaker oracle must not silently become a valid manifest.
const canonicalOracleKinds = Object.freeze({
  "type_of.closed_nominal": "compile-and-run",
  "fields_of.public_order": "compile-and-run",
  "methods_of.static_signatures": "compile-and-run",
  "implements.static_witness": "compile-and-run",
  "generics.closed_specialization": "compile-and-run",
  "private_field.redacted": "runtime-deny",
  "actor_state.unauthorized": "runtime-deny",
  "actor_state.authorized_snapshot": "compile-and-run",
  "tenant.foreign_denied": "runtime-deny",
  "actor_generation.stale_denied": "runtime-deny",
  "field_reference.no_escape": "compile-reject",
  "descriptor.no_raw_pointer": "compile-reject",
  "descriptor.no_implicit_invoke": "compile-reject",
  "runtime_generic.no_specialize": "compile-reject",
  "runtime_eval.forbidden": "compile-reject",
  "runtime_proxy.forbidden": "compile-reject",
  "classpath_scan.forbidden": "artifact-inspection",
  "serializer.compiler_generated": "compile-and-run",
  "metadata.deterministic": "build-metadata",
  "metadata.layout_target_specific": "build-metadata",
  "type_id.collision_denied": "runtime-deny",
  "metadata.malformed_denied": "runtime-deny",
  "metadata.bounded": "artifact-inspection",
  "retention.unused_stripped": "artifact-inspection",
  "retention.explicit_root": "artifact-inspection",
  "retention.unauthorized_root": "compile-reject",
  "hot_load.verified_module": "compile-and-run",
  "hot_load.abi_mismatch": "runtime-deny",
  "hot_load.generation_fence": "compile-and-run",
  "jit_escape.forbidden": "artifact-inspection",
  "aot.native_execution": "compile-and-run",
  "isolate.no_mixed_authority": "runtime-deny"
});

// Required witness identities are part of the reviewed contract; a manifest
// cannot silently weaken an oracle while preserving its ID and stage.
const canonicalOracleWitnesses = Object.freeze({
  "type_of.closed_nominal": Object.freeze(["compile-time-symbol-resolution","no-runtime-class-discovery"]),
  "fields_of.public_order": Object.freeze(["read-only-metadata","deterministic-field-order"]),
  "methods_of.static_signatures": Object.freeze(["closed-dispatch-set","no-callable-pointer-exposure"]),
  "implements.static_witness": Object.freeze(["no-mutable-runtime-implementation-registry"]),
  "generics.closed_specialization": Object.freeze(["finite-generic-closure"]),
  "private_field.redacted": Object.freeze(["no-information-leak"]),
  "actor_state.unauthorized": Object.freeze(["actor-isolation","capability-denied"]),
  "actor_state.authorized_snapshot": Object.freeze(["runtime-issued-capability","copy-or-borrow-under-guard"]),
  "tenant.foreign_denied": Object.freeze(["tenant-isolation"]),
  "actor_generation.stale_denied": Object.freeze(["generation-fenced-tickets"]),
  "field_reference.no_escape": Object.freeze(["compile-time-borrow-check"]),
  "descriptor.no_raw_pointer": Object.freeze(["opaque-descriptor-handles"]),
  "descriptor.no_implicit_invoke": Object.freeze(["explicit-invocation-capability-required"]),
  "runtime_generic.no_specialize": Object.freeze(["no-runtime-codegen"]),
  "runtime_eval.forbidden": Object.freeze(["no-eval"]),
  "runtime_proxy.forbidden": Object.freeze(["no-dynamic-assembly"]),
  "classpath_scan.forbidden": Object.freeze(["no-classpath-scan"]),
  "serializer.compiler_generated": Object.freeze(["no-reflection-serializer-fallback"]),
  "metadata.deterministic": Object.freeze(["stable-sort-and-encoding"]),
  "metadata.layout_target_specific": Object.freeze(["abi-separation"]),
  "type_id.collision_denied": Object.freeze(["collision-check"]),
  "metadata.malformed_denied": Object.freeze(["bounded-reads"]),
  "metadata.bounded": Object.freeze(["bounded-resource-use"]),
  "retention.unused_stripped": Object.freeze(["tree-shaking-evidence"]),
  "retention.explicit_root": Object.freeze(["opt-in-retention"]),
  "retention.unauthorized_root": Object.freeze(["no-authority-from-retention"]),
  "hot_load.verified_module": Object.freeze(["precompiled-only","generation-pinned"]),
  "hot_load.abi_mismatch": Object.freeze(["fail-closed-version-negotiation"]),
  "hot_load.generation_fence": Object.freeze(["quiescent-retirement"]),
  "jit_escape.forbidden": Object.freeze(["native-code-provenance"]),
  "aot.native_execution": Object.freeze(["exact-head-and-tree","stepful-guest-execution"]),
  "isolate.no_mixed_authority": Object.freeze(["isolate-generation-fence"])
});

export function verifyManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (manifest?.contract !== 'attolang.aot-reflection/1') errors.push('contract');
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion');
  if (manifest?.status !== 'candidate-unattested') errors.push('candidate status must not assert execution');
  const expectedBackends = ['java', 'llvm', 'wasm', 'forge', 'net'];
  if (!manifest?.backends || typeof manifest.backends !== 'object' ||
      Array.isArray(manifest.backends) ||
      Object.keys(manifest.backends).length !== expectedBackends.length ||
      expectedBackends.some(b => !Object.hasOwn(manifest.backends, b) ||
          typeof manifest.backends[b] !== 'string' || !manifest.backends[b].trim()))
    errors.push('exact backend set required');
  const cases = manifest?.cases;
  if (!Array.isArray(cases) || cases.length !== 32) errors.push('32 oracle cases required');
  if (Array.isArray(cases)) {
    const ids = new Set();
    for (const c of cases) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        errors.push('case must be a structured object');
        continue;
      }
      if (typeof c.id !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(c.id) || ids.has(c.id)) errors.push('case id duplicate/invalid');
      ids.add(c.id);
      if (!Object.hasOwn(canonicalOracleKinds, c.id) || canonicalOracleKinds[c.id] !== c.kind)
        errors.push('unknown or remapped canonical oracle: ' + c.id);
      if (!Object.hasOwn(expectedStage, c.kind)) errors.push('invalid oracle kind: ' + c.id);
      if (typeof c.oracle !== 'string' || !c.oracle.trim()) errors.push('missing oracle: ' + c.id);
      if (!Array.isArray(c.mustProve) || !c.mustProve.length ||
          c.mustProve.some(w => typeof w !== 'string' || !/^[a-z][a-z0-9-]{1,99}$/.test(w)) ||
          new Set(c.mustProve).size !== c.mustProve.length)
        errors.push('invalid witness set: ' + c.id);
      if (typeof c.id === 'string' && Object.hasOwn(canonicalOracleWitnesses, c.id) &&
          (!Array.isArray(c.mustProve) ||
           c.mustProve.length !== canonicalOracleWitnesses[c.id].length ||
           canonicalOracleWitnesses[c.id].some(w => !c.mustProve.includes(w))))
        errors.push('canonical oracle witnesses changed: ' + c.id);
      if (c.evidence !== 'NOT_EXECUTED') errors.push('fabricated contract evidence: ' + c.id);
      if (!Array.isArray(c.backends) || c.backends.length !== expectedBackends.length ||
          expectedBackends.some(b => !c.backends.includes(b))) errors.push('incomplete backends: ' + c.id);
    }
    for (const expected of Object.keys(canonicalOracleKinds)) {
      if (!ids.has(expected)) errors.push('missing canonical oracle: ' + expected);
    }
  }
  return errors;
}

export function verifyReceipt(manifest, receipt) {
  const errors = verifyManifest(manifest);
  if (errors.length > 0) return { classification: 'INVALID', errors };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { classification: 'INVALID', errors: [...errors, 'receipt missing'] };
  }
  if (receipt.contract !== manifest.contract) errors.push('receipt contract mismatch');
  // Scope must be explicit: omission must not silently claim all-case parity.
  const scope = receipt.scope;

  if (!['complete', 'milestone'].includes(scope)) errors.push('unknown receipt scope');
  if (scope === 'milestone' &&
      (typeof receipt.milestoneId !== 'string' ||
       !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(receipt.milestoneId))) {
    errors.push('milestone receipt requires a stable milestoneId');
  }
  if (!Object.hasOwn(manifest.backends ?? {}, receipt.backend ?? '')) errors.push('unknown backend');
  if (receipt.manifestSha256 !== undefined && !sha256.test(receipt.manifestSha256)) errors.push('invalid manifest digest');
  if (receipt.status !== 'native-aot-claim') errors.push('receipt must mark itself as an unverified native-aot claim');
  for (const key of ['headSha', 'treeSha']) {
    if (!sha40.test(receipt[key] ?? '')) errors.push('invalid ' + key);
  }
  for (const key of ['compilerBinarySha256', 'artifactSha256', 'fixtureManifestSha256', 'metadataSectionSha256']) {
    if (!sha256.test(receipt[key] ?? '')) errors.push('invalid ' + key);
  }
  const job = receipt.job && typeof receipt.job === 'object' && !Array.isArray(receipt.job) ? receipt.job : {};
  if (!Number.isSafeInteger(job.runnerId) || job.runnerId <= 0) errors.push('runner was not admitted');
  if (!Number.isSafeInteger(job.runAttempt) || job.runAttempt <= 0) errors.push('missing run attempt');
  if (!Array.isArray(job.steps) || job.steps.length === 0 ||
      job.steps.some(s => !s || typeof s !== 'object' || Array.isArray(s) ||
        typeof s.name !== 'string' || !s.name || s.conclusion !== 'success')) errors.push('no completed stepful successful workflow');
  const build = receipt.build && typeof receipt.build === 'object' && !Array.isArray(receipt.build) ? receipt.build : {};
  for (const k of ['sourceTreeMatched', 'compilerProvenanceChecked', 'compilerGuestExecuted',
                   'aotArtifactExecuted', 'noJitFallback', 'retentionInspected']) {
    if (build[k] !== true) errors.push('missing declared proof: ' + k);
  }
  if (typeof build.targetTriple !== 'string' || !build.targetTriple.trim()) errors.push('missing target triple');
  if (typeof build.compilerInvocation !== 'string' || !build.compilerInvocation.trim()) errors.push('missing compiler invocation');
  if (typeof build.executionInvocation !== 'string' || !build.executionInvocation.trim()) errors.push('missing guest invocation');
  if (typeof build.provenanceUrl !== 'string' || !/^https:\/\//.test(build.provenanceUrl)) errors.push('missing external build provenance');
  if (typeof receipt.reviewUrl !== 'string' || !/^https:\/\//.test(receipt.reviewUrl)) errors.push('missing independent review reference');
  const submitted = receipt.results;
  const ids = new Set();
  const allCases = manifest.cases ?? [];
  if (!Array.isArray(submitted) || submitted.length === 0 ||
      (scope === 'complete' && submitted.length !== allCases.length) ||
      (scope === 'milestone' && submitted.length > allCases.length)) {
    errors.push('case count mismatch');
  }
  if (Array.isArray(submitted)) {
    const lookup = new Map((manifest.cases ?? []).map(c => [c.id, c]));
    for (const entry of submitted) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || ids.has(entry.id)) { errors.push('duplicate or invalid case id'); continue; }
      ids.add(entry.id);
      const oracle = lookup.get(entry.id);
      if (!oracle) { errors.push('unrecognized case: ' + entry.id); continue; }
      if (entry.backend !== undefined && entry.backend !== receipt.backend) errors.push('case backend mismatch: ' + entry.id);
      if (entry.result !== 'PASS' || entry.stage !== expectedStage[oracle.kind]) errors.push('wrong result or stage: ' + entry.id);
      if (!sha256.test(entry.fixtureSha256 ?? '')) errors.push('missing fixture digest: ' + entry.id);
      if (!Array.isArray(entry.witnesses) || oracle.mustProve.some(w => !entry.witnesses.includes(w))) errors.push('missing oracle witnesses: ' + entry.id);
      if (oracle.kind === 'compile-reject') {
        if (entry.noOutputArtifact !== true) errors.push('rejection generated output: ' + entry.id);
        if (entry.compilerExitCode !== 1 || typeof entry.diagnosticClass !== 'string' ||
            !/^[a-z][a-z0-9_]{2,79}$/.test(entry.diagnosticClass))
          errors.push('missing stable compiler rejection evidence: ' + entry.id);
      }
      if (oracle.kind === 'runtime-deny' && entry.denialObserved !== true) errors.push('denial unproven: ' + entry.id);
      if (oracle.kind === 'artifact-inspection' &&
          (!sha256.test(entry.inspectionSha256 ?? '') ||
           entry.inspectedArtifactSha256 !== receipt.artifactSha256))
        errors.push('missing/binary-mismatched inspection: ' + entry.id);
      if (oracle.kind === 'build-metadata' && !sha256.test(entry.comparisonSha256 ?? '')) errors.push('missing deterministic build evidence: ' + entry.id);
    }
    if (scope === 'complete') {
      for (const c of allCases) if (!ids.has(c.id)) errors.push('missing case: ' + c.id);
    } else if (scope === 'milestone' &&
               (!ids.has('aot.native_execution') ||
                !submitted.some(e => e && e.id !== 'aot.native_execution' &&
                    lookup.get(e.id)?.kind === 'compile-and-run'))) {
      errors.push('milestone requires native execution and a positive compiled feature oracle');
    }
  }
  // This is not an attestation: fields can be invented or inconsistent with real GitHub jobs.
  return {
    classification: errors.length ? 'INVALID' :
      (scope === 'milestone' ? 'MILESTONE_SHAPE_VALID_UNATTESTED' :
       'SHAPE_VALID_UNATTESTED'),
    errors
  };
}

const invokedAsMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsMain) {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../contracts/aot-reflection-v1.json', import.meta.url), 'utf8'));
    const receiptPath = process.argv[2];
    if (!receiptPath) {
      console.error('Usage: node bin/verify-aot-reflection-receipt.mjs RECEIPT.json');
      process.exitCode = 2;
    } else {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      const response = verifyReceipt(manifest, receipt);
      console.log(JSON.stringify(response, null, 2));
      // A successful structural parse is never native-AOT evidence.
      // Fail closed by default, even when the receipt is structurally sound.
      // Use --lint-only explicitly for a structural quality gate; this still
      // cannot attest any GitHub job, compiler provenance or native binary.
      const lintOnly = process.argv[3] === '--lint-only' && process.argv.length === 4;
      process.exitCode = response.errors.length || !lintOnly ? 1 : 0;
    }
  } catch (error) {
    console.error('INVALID: ' + error.message);
    process.exitCode = 1;
  }
}
