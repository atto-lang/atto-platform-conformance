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
| java | actual `oreslang-source.java` frontend, guest runtime binary digest | GraalVM/Truffle guest evaluation, not a Java host-only oracle |
| llvm | real `oreslang-source.llvm` compiler | compiled and executed native guest artifact |
| wasm | `oreslang-source.wasm` compiler bridge **plus** exact upstream `oreslang-source.llvm` compiler SHA and executable digest | LLVM IR → Clang/LLD `.wasm` → zero-import Wasm runtime with pinned host binary; compiled-only is not executed |
| cranelift | actual **oreslang-source.cranelift** Rust frontend | native Cranelift JIT, compiler commit/binary SHA, generated CLIF IR digest and executed JIT guest |
| net | real `oreslang-source.net` compiler | published NativeAOT host executable with pinned bytes, no managed JIT substitution |

The Cranelift lane is a real separate, experimental Oreslang Rust/Cranelift compiler; the repository is **oreslang-source.cranelift**. It currently implements only a narrow checked-i64 scalar JIT profile. It is **not** a Wasmtime/Cranelift alias, not the LLVM backend, and not proof of full Oreslang actor or platform support.
A backend-specific evidence object is required for the Wasm LLVM-to-Wasm bridge,
Java/Graal Truffle engine, .NET NativeAOT host and native Cranelift JIT.
The Wasm bootstrap is not a standalone Oreslang frontend, while the dedicated
Cranelift Rust compiler **is**. All provenance objects are only receipt-shape
validation until checked against external native job/artifact evidence.

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
