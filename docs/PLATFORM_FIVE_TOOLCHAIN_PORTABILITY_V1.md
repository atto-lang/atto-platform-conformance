# Portable Oreslang platform source and native execution gate v1

**Status: UNEXECUTED / NOT CERTIFIED.** This is an independent draft contract,
not proof that any Oreslang compiler, Wasmtime Cranelift engine, target MCU,
desktop/mobile app, FPGA, or ASIC ran these programs.

## Shared guest source

`fixtures/platform-portability-v1/*.ores` contains **10 native Oreslang programs**:
8 positive scalar/precedence probes with explicit integer `main` values,
and 2 negative unresolved-identifier probes. The exact 10 SHA-256 digests,
expected values, diagnostics and case IDs are pinned redundantly in
`contracts/platform-portability-v1.json` and the implementation. No Python,
JavaScript, C, Rust or .NET guest language substitutes for the `.ores` code.

`node --test tests/platform-portability-v1.test.mjs` checks the corpus,
rejected substitutions, source/runner provenance and forged receipts.
`node bin/platform-portability-v1.mjs` reports the **30 unexecuted
platform/toolchain lanes** and **300 not-yet-executed case runs**.
`node bin/platform-portability-v1.mjs --require-executed` **must exit nonzero**
until a separately audited compiler-backed receipt system is available.

## Toolchain map

| Lane | Source lowering requirement | Runtime/engine distinction |
|---|---|---|
| java | real `oreslang-source.java` executable and source SHA | GraalVM or supported Java guest runtime, not a mock |
| llvm | real `oreslang-source.llvm` compiler | native executable or justified target ABI |
| wasm | real `oreslang-source.wasm` compiler | Wasm compilation **alone** is not a Cranelift run |
| cranelift | **same actual Wasm source-lowering frontend** | independent Wasmtime/Cranelift engine binary SHA, engine revision, emitted module SHA, executed engine job |
| net | real `oreslang-source.net` compiler | actual .NET NativeAOT executable, not C# host reference |

A Cranelift lane is *not* a fabricated fifth Oreslang source frontend.
A platform and toolchain being present in the matrix does **not** imply
that backend supports the target CPU, WASI imports, guest/host ABI, heap,
actor semantics, or native hardware. Unsupported capabilities must be
reported as unsupported rather than substituted by the host/reference engine.

## Platform acceptance stages

All six platform repositories (IoT, embedded, desktop, mobile, FPGA,
ASIC) need independently evidenced platform-level ABI/FFI and capability
admission **before** those portable scalar runs can be promoted to
product compatibility. The 10 cases are a first semantic floor, not
proof of actors, supervision, I/O, ownership, cancellation, hot reload,
isolate heaps, interrupt/ISR correctness, JNI or Swift ABI, or physical
FPGA/ASIC verification. Those need separate `.ores` guest fixtures
and device-native tests.

All release receipts must bind the exact source/target Git tree,
compiler HEAD, compiler executable digest, generated artifact digest,
runner/job IDs and actual nonzero executed steps. Positive programs must
execute under the specified target and return a checked value; negative
programs must produce a primary compiler diagnostic. Pure host unit
tests, synthetic/claimed receipts, or zero-step workflows do **not**
establish compiler-backed parity. The validator intentionally returns
`certifiedParity:false` even for 300 syntactically valid caller-supplied
observations; independently authenticated backend runs and reviews are
still required.

**Security:** no private-source cross-organization mirror without the
independent per-snapshot approval and transfer-incident disposition in
conformance PR #263. Available Actions minutes do not grant permission
to export private Git history. Branch rulesets, CODEOWNER approval, and
exact-head stepful CI are still open gates.

## Promotion sequence

1. Finish independent review of the raw-checkout CI patch (#267), keep
   metadata-only runner-admission tests source-free, and restore runner
   admission.
2. Execute all 10 `.ores` cases in each actual compiler/backend route,
   with consistent typed results, diagnostics and binary provenance.
3. Verify platform-specific native ABI, ownership and resource fences,
   followed by guest/host integration and real target evidence.
4. Add signed, independently trusted verification of runs and artifact
   bytes. Only then consider moving pending matrix lanes out of
   `NOT_EXECUTED` and admitting a protected merge.

The five-toolchain/ten-case matrix is explicitly **aspirational**.
The evidence gate fails closed rather than claiming target parity today.
