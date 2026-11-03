# Portable Oreslang platform source and native execution gate v1

**Status: UNEXECUTED / NOT CERTIFIED.** This is an independent draft contract,
not proof that any Oreslang compiler, Wasmtime Cranelift engine, target MCU,
desktop/mobile app, FPGA, or ASIC ran these programs.

## Shared guest source

`fixtures/platform-portability-v1/*.ores` contains **10 native Oreslang programs**:
8 positive scalar/precedence probes with explicit integer `main` values,
and 2 negative unresolved-identifier probes. The exact 10 SHA-256 digests,
expected values, diagnostics and case IDs are pinned redundantly in
`contracts/platform-portability-v1.json` and the implementation.
The fixture directory is an exact **ten-file** inventory: additional
regular files, hidden entries, symlinks, missing files and directory
masquerades are rejected before any guest program is launched. No Python,
JavaScript, C, Rust or .NET guest language substitutes for the `.ores` code.

`node --test tests/platform-portability-v1.test.mjs` checks the corpus,
rejected substitutions, source/runner provenance and forged receipts.
`node bin/platform-portability-v1.mjs` reports the **30 unexecuted
platform/toolchain lanes** and **300 not-yet-executed case runs**.
`node bin/platform-portability-v1.mjs --require-executed` **must exit nonzero**
until a separately audited compiler-backed receipt system is available.

## Real native Cranelift guest runner (separate from host tests)

The conformance branch now includes
`bin/run-cranelift-native-v1.mjs`. Given an independently installed real
`orescranelift` executable and its **actual** SHA-256 digest, it invokes
`ir <source.ores>` and `run <source.ores>` separately for all ten fixtures,
checks CLIF generation, exact integer stdout, and the compiler-owned
unresolved-identifier diagnostics. It rehashes the executable after every
case and rejects symlinked binaries, timeouts, unexpected stdout, wrong
diagnostics and persistent guest-source mutations detected by post-invocation
corpus revalidation. The exported runner rejects unexpected or accessor
options, inherited option objects and caller-supplied `spawn` hooks:
source-verification evidence must be produced by its real process-launch
entrypoint, not by an injected mock callback. This is not a race-free,
trusted source-to-executable attestation: a mutate-and-restore adversary
or a forged compiler binary still requires an independently controlled
execution environment.

On Linux, the native-image preflight additionally checks for an ELF64
little-endian executable/PIE, the expected x86-64 or AArch64 machine, and
a nonempty, bounded program-header table. It rejects script wrappers,
ELF-magic-only files and wrong-architecture headers before execution.
Format checks on macOS and Windows are less comprehensive. None of these
checks proves that the executable was built from the declared compiler Git
commit or that the binary is nonmalicious; that requires independently
controlled build provenance and signed/verified artifacts.

```sh
node bin/run-cranelift-native-v1.mjs \
  --compiler=/absolute/path/to/orescranelift \
  --compiler-sha256=YOUR_VERIFIED_64_HEX_DIGEST \
  --compiler-commit=YOUR_VERIFIED_40_HEX_SOURCE_COMMIT
```

Missing or unverified binaries must exit nonzero. A valid local run is
`LOCAL_NATIVE_OBSERVATION_NOT_INDEPENDENTLY_ATTESTED`, **never**
platform or cross-backend certification. Independently authenticated
exact-head Actions jobs with executed steps and real native compiler provenance
are required for promotion. The local runner does not exercise physical
IoT/embedded/FPGA/ASIC targets.

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
compiler HEAD, compiler executable digest, and actual nonzero
runner/job steps. **Positive** guest observations require an authenticated,
generated artifact digest; **negative** source-rejection observations must set
`artifactSha256: null`, because no guest artifact exists. A rejected
Cranelift program must likewise report `clifSha256: null`, and a rejected
Wasm source must report `wasmModuleSha256: null` and `zeroImports: null`
rather than inventing module properties. Compiler and pre-existing
NativeAOT/Wasm host binary digests remain required independently of source
rejection. Positive programs must execute under the specified target and
return a checked value; negative programs must produce a primary compiler
diagnostic without claiming generated guest code. Pure host unit
tests, synthetic/claimed receipts, or zero-step workflows do **not**
establish compiler-backed parity. The validator intentionally returns
`certifiedParity:false` even for 300 syntactically valid caller-supplied
observations; independently authenticated backend runs and reviews are
still required.

**Snapshot coherence:** `compareObservations` also rejects revision mixing:
all recorded cases must share one source Git commit; each platform must
use one target Git commit across cases and backends; each backend must
use one compiler source commit across all platforms; and each individual
platform/backend lane must use one compiler binary digest across its
cases. Wasm observations must also agree on the upstream LLVM
compiler source revision, including with direct LLVM observations when
both routes are present; each Wasm platform/backend lane must use one
upstream LLVM compiler executable digest and one Wasm runtime-host digest.
Likewise, each Java/Graal lane must use one guest-engine binary digest
and one runtime version. Different target architectures may legitimately
produce different compiler and runtime-host binary digests across platform
lanes. A generated Wasm module and a published .NET NativeAOT guest artifact
are **per-fixture outputs**, not stable per-lane engine identities: their
digests may differ between test programs. Any coherence failure is
`DIVERGENT` even if every scalar result matches the oracle.
**GitHub run and job ID consistency:** a run ID must identify the same
repository and exact source head across all observations. A job ID may not be
reused with a different run ID, attempt, runner, conclusion or executed-step
inventory. Multiple jobs within one run are allowed, as are separately
identified jobs from later run attempts. An identical claimed job may report
multiple positive/negative fixture outcomes, but its GitHub step inventory
must stay identical across those claims. The validator only detects
contradictions: it does **not** contact GitHub or independently attest that
any claimed run, job, runner or successful step exists.

These are consistency checks on *untrusted claims*, not verification of
GitHub runner identities, source provenance, executable builds or device
attestations.

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
