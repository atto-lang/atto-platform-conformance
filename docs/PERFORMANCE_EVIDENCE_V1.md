# Cross-target optimization evidence v1 (proposed)

Status: **draft schema and validation contract only**. CI of a schema/harness does not establish runtime/compiler correctness, and no actual performance measurement is included in this proposal.

## Why a common envelope, not a common speed metric
A native JVM latency sample, LLVM executable runtime, Wasm SIMD throughput, FPGA initiation interval and ASIC mapped-cell area are **incomparable** until the environment, unit and interpretation are captured. Do not combine them into a platform-agnostic speedup rank.

## Proposed result envelope
```json
{
  "schemaVersion": 1,
  "producer": "independently-reviewed-benchmark-runner",
  "status": "UNCONFIGURED",
  "family": "software",
  "backend": "llvm",
  "mode": "baseline-O2",
  "sourceSha": "0000000000000000000000000000000000000000",
  "compilerSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "fixtureSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "toolchain": {"name": "clang", "version": "unconfigured"},
  "environment": {"target": "host", "cpu": "unknown", "clockPolicy": "unknown"},
  "kind": "latency",
  "unit": "ns",
  "samples": [],
  "correctness": "UNVERIFIED",
  "evidence": []
}
```
This object is **illustrative and intentionally UNCONFIGURED**; synthetic zeros and no samples must never validate as a measured success. No schema is yet implemented by this PR.

## Required validation semantics
- `PASS` is invalid unless exact source/tool/fixture evidence, measured samples, a reference correctness result, and defensible run provenance exist.
- Typed families: software latency/throughput/allocations/build metrics; FPGA II/latency/Fmax/LUT/FF/BRAM/DSP; ASIC mapped area/critical path/slack and independently justified power.
- Target-specific status enums: `UNCONFIGURED`, `UNSUPPORTED`, `NOT_VECTORIZED`, `SIMULATED_ONLY`, `SYNTH_ONLY`, `PLACE_ROUTE_VERIFIED`, `MEASURED`, `FAIL`. Reject unrecognized or inflated status.
- Store both raw and aggregate values; warmup/training samples cannot count as held-out benchmark samples. Record number of independent trials, confidence/dispersion and clock, CPU/target/toolchain characteristics.
- Require explicit comparability keys (fixture hash, units, target, compilation mode, correctness profile); no unstated cross-platform performance claim.
- A generated schema fixture or fake runner cannot authenticate native compilers or hardware. Existing `docs/REAL_COMPILER_EVIDENCE.md` policy applies unchanged.

## Implementation backlog
- [ ] Publish a strict versioned JSON Schema, with limits on payload size, sample lengths and numeric ranges
- [ ] Add fixtures: valid unconfigured example, attempted forged PASS, missing hashes, unknown units, NaN/negative measurements, mixed hardware/software dimensions, unsupported feature claims
- [ ] Implement CLI validator + tests; CI tests the validator, not runtime claims
- [ ] Integrate only real signed-off/pinned artifacts from Java/LLVM/Wasm/HDL and physically measured FPGA/ASIC workflows
- [ ] Document approval flow for selecting practical non-flaky per-target regression thresholds

Tracking: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/80
