# Cross-target optimization evidence v1 (experimental)

Status: **implemented structural validator + bounded CLI on this draft branch**. This is not authenticated benchmark evidence, an independent schema attestation, or a compiler performance result.

## How to validate a report

```sh
# JSON parsing, strict fields, typed units, hash-shape and claimed evidence gates:
node bin/check-performance-evidence.mjs /path/to/report.json --structural-only
# Deliberately returns exit 3 even if structurally valid:
node bin/check-performance-evidence.mjs /path/to/report.json
# Node 22+ unit + CLI negative fixtures:
npm test
```

The validator at `src/performance-evidence.mjs` has strict exact fields, bounded samples and artifact references, 40/64-character lowercase hex hashes (nonzero for reported measurements), backend/family combinations, typed units, and stage-specific correctness/evidence requirements. The CLI refuses links and oversized input; the Node unit tests cover structural false positives.

**Security:** a self-authored report can fabricate plausible source hashes, compiler versions, samples and artifact locators. A structurally valid report always returns `performance_claim_certified:false` and `provenance_authenticated:false`. Independent toolchain, artifact, real-compiler execution and source SHA attestation are a separate release gate. Passing CI tests of a report validator proves only that the validator behaves as tested.

## Report format

The v1 object has exactly these fields: `schemaVersion`, `status`, `family`, `backend`, `mode`, `sourceSha`, `compilerSha256`, `fixtureSha256`, `toolchain:{name,version}`, `environment:{target,cpu,clockPolicy}`, `kind`, `unit`, `samples`, `correctness`, and `evidence:[{stage,sha256,locator}]`.

The following example is deliberately unconfigured. It cannot be promoted as a measured success.

```json
{
  "schemaVersion": 1,
  "status": "UNCONFIGURED",
  "family": "software",
  "backend": "llvm",
  "mode": "baseline-O2",
  "sourceSha": "0000000000000000000000000000000000000000",
  "compilerSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "fixtureSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "toolchain": {"name": "clang", "version": "unconfigured"},
  "environment": {"target": "unknown", "cpu": "unknown", "clockPolicy": "unknown"},
  "kind": "latency",
  "unit": "ns",
  "samples": [],
  "correctness": "UNVERIFIED",
  "evidence": []
}
```

## Metric registry

| Family | Backend | Metric kind | Unit |
| --- | --- | --- | --- |
| software | java, llvm, wasm | latency; throughput; allocation | ns; ops/s; bytes/op |
| software | java, llvm, wasm | build_time; image_size | ms; bytes |
| fpga | fpga | ii; fmax; lut; ff; bram; dsp | cycles; MHz; count; count; count; count |
| asic | asic | area; slack; critical_path; power | um2; ns; ns; mW |

Sampling requires 5+ values to claim `MEASURED`. A stage claim like `SYNTH_ONLY` requires reference to actual synthesis and correctness artifacts, but these references cannot be independently verified by the JSON parser. FPGA `PLACE_ROUTE_VERIFIED` requires an explicit place-route artifact reference. ASIC power requires a switching/library power model artifact reference. No self-declared status is a certificate.

## Next implementation backlog

- [x] Strict fail-closed v1 structural validator and Node 22 CLI with size/link checks
- [x] Positive/negative unit tests, including forged PASS, invalid units/hashes, unsupported target and file-safety cases
- [ ] Publish a matching machine-independent JSON Schema as an additional editor/schema integration contract
- [ ] Independently authenticate real compiler binary provenance and CI artifact digests
- [ ] Add benchmark collection adapters and exact execution evidence from Java, LLVM and Wasm
- [ ] Add FPGA real P&R and ASIC mapped-cell reports, independently signed off with constraints and raw logs
- [ ] Define target-specific comparison cohorts, confidence intervals and reviewed regression thresholds

Tracking: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/80

## October 18 hardening and source-free CI status

- Added `schemas/performance-evidence.schema.json` (JSON Schema draft 2020-12), with strict field closure and family/backend/metric/unit/status constraints. This schema supports editor/integrator validation; the executable `src/performance-evidence.mjs` remains the authoritative structural gate. Neither authenticates reports.
- Added schema-to-runtime consistency tests, including no self-attestation fields and an explicit disallow of `MEASURED` ASIC silicon without a future silicon provenance protocol.
- A `MEASURED` software report requires benchmark artifacts. FPGA `MEASURED` requires separate P&R, board and benchmark artifacts; an ASIC `SYNTH_ONLY` area/power estimate needs synthesis and, for power, library/switching-model references. References remain self-reported until independently verified.
- Strengthened the CLI's secure-open preflight: missing, zero or aliased no-follow/non-blocking file flags deny processing; invalid UTF-8 evidence bytes reject instead of being silently normalized. The CLI still returns nonzero unless an operator explicitly requests structural-only inspection.
- Original organization Actions continues to fail with `steps:null`, including on `main`. This is **not** proof of a code-test failure or billing cause. No hosted CI correctness pass is claimed.
- A protected-source export hold is active in the same repository (security PR #86, incidents #22/#77). Approval of a private destination or availability of another organization's Actions minutes is **not** permission to mirror private code. Only independent protected-main review and incident clearance can authorize any later export.

Remaining: run the complete Node test suite on an independently approved source-local runner; validate machine-readable schema using an independent JSON Schema engine; preserve independent attestation/no promotion.
