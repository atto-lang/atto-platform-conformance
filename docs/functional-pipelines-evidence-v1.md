# Atto functional-pipeline guest evidence v1

Canonical source: [atto-spec PR #121](https://github.com/atto-lang/atto-spec/pull/121), `conformance/functional-pipelines-v1/cases.json`.

This ledger is a **gating mechanism, not a test result**. The four positive `.atto` programs must compute `main(): int` values `83, 83, 42, 42`; four negative canonical programs must reject without publishing a guest artifact. The eight source Git blob SHAs are fixed in `contracts/functional-pipelines-v1/ledger.json`.

## Do not confuse return values with OS exit codes

A compiler's guest `main()` value is the language result, independent of the target's process or embedding ABI:

- `os_exit_code`: the actual compiled guest returns process status 83 or 42 with empty stdout, as with the bounded .NET/Java/LLVM profiles.
- `stdout_line_i64`: the real native scalar guest prints `83\n` or `42\n` and exits 0. Forge and Cranelift currently use this ABI. A host-only program calculating 83 is **not** acceptable.
- `wasm_export_i64`: the actual compiled Wasm guest exposes the returned integer through an executed export. Require the export name and observed value, plus valid admission and guest binary hashes.

These profiles are **measurement adapters**, not alternative AttoLang semantics. The evidence must record the raw process exit/stdout or guest export, not silently reinterpret a zero-step test run or substitute a host reference computation.

## Promoting a backend from `not_executed` to `passed`

Every receipt must identify an exact compiler head and Git tree, one nonzero-step CI run URL, toolchain, actual guest command, and **all eight** per-fixture results with the pinned fixture blob SHA. Every positive requires actual compiled execution, its raw return transport, the normalized observed `main` value, and SHA-256 of a named generated artifact (native binary/LLVM or Cranelift IR/Wasm/CIL). Every negative must record a typed `type` or `syntax` rejection and zero resulting guest artifacts.

Compiler source files, parser tests, host-only model tests, GHA startup failures, stale pre-commit CI, or the existence of generated source code cannot establish `passed`.

Current implementation PRs: [Rust #381](https://github.com/atto-lang/atto-source.rs/pull/381), [LLVM #54](https://github.com/atto-lang/atto-source.llvm/pull/54), [.NET #16](https://github.com/atto-lang/atto-source.net/pull/16), [Java #51](https://github.com/atto-lang/atto-source.java/pull/51), [Forge #45](https://github.com/atto-lang/atto-source.forge/pull/45), [Cranelift #50](https://github.com/atto-lang/atto-source.cranelift/pull/50), [formatter #26](https://github.com/atto-lang/atto-format/pull/26). Forge and Cranelift are restricted scalar compiler paths, not general language/actor/TenantVM parity.

This work is tracked in [atto-platform-conformance issue #105](https://github.com/atto-lang/atto-platform-conformance/issues/105). Tests: `node --test tests/functional-pipelines-ledger.test.mjs` is **manifest integrity only**, not compiled guest verification.

## Supplemental argument-order and signed-int64 edge contract

[atto-spec#121](https://github.com/atto-lang/atto-spec/pull/121) adds
conformance/functional-pipelines-v1/edge/cases.json as a **separate**
seven-case extension. The original eight canonical fixtures are unchanged.
The extension pins three successful guest values (61, 42 and
-9223372036854775808), one runtime checked-overflow result, and three
compile-time no-artifact rejections. Both forward and reverse applications
insert the piped value as argument zero. Explicit arguments retain order.

All seven source fixtures were independently byte-verified in JavaScript,
Java, .NET, Forge and Cranelift. Rust browser/Wasm and the Rust-fronted LLVM
native compiler have SHA-exact copies and real guest tests for the two
multi-argument successful programs. All of these are **authored test
gates**, not CI-executed passes. Independent native LLVM C++, production
Java/Truffle, production Forge, and secure TenantVM remain separate targets.

The exact JavaScript compiler source blob
2d3cd3a30e6cd41bcd7eac0294053ff3e77ccd99 was exercised in an
**in-process V8 compiled-code smoke harness**: actual generated functions
returned 61, 42 and signed-i64 MIN; compiled overflow raised E_OVERFLOW;
all three invalid sources were rejected. This is not a Node ESM guest
process nor CI, and has a separate local smoke record instead of a
backend PASS receipt.

The .NET direct-CIL PR fixes an artifact integrity bug: invalid Atto
source no longer deletes an existing generated DLL, successful compilation
cannot overwrite existing DLLs, and temporary creation is exclusive.
Tests cover fresh-output deterministic recompiles, CoreCLR and NativeAOT
multi-argument guests, signed-i64 minimum, checked overflow and no-output
rejections. These changes require the unavailable .NET SDK/NativeAOT runner
before a success claim.

**Stale evidence discipline:** the restricted Java compiler's source changed
after its earlier observed JDK21 guest runs. The historical local receipt
remains attached to its earlier source Git blob, explicitly marked
source_changed_since_local_observation. Every target in the extension
remains not_executed with a null CI receipt.

## Eight fresh private GitHub carrier admission canaries (2026-11-20)

Each carrier was tested on a temporary branch named
`ci/canary-functional-pipeline-capacity-20261120`, containing a
minimal single-job, single-shell-step Ubuntu Actions workflow. The
job performs only `echo` and `command -v git`. It has read-only
content permissions, no checkout, no source files from Atto, and
no cross-organization credentials.

| Authorized private carrier | Workflow run | Steps executed |
| --- | ---: | ---: |
| benefactor-cc/atto-ci | 44682112211 | 0 |
| voxletra/atto-ci | 44682117376 | 0 |
| scintilla-run/atto-ci | 44682361850 | 0 |
| athlet-o/atto-ci | 44682367642 | 0 |
| agent-pontifex/atto-ci | 44682371219 | 0 |
| honeypot-r-us-test/atto-ci | 44682377706 | 0 |
| akrion-sim/atto-ci | 44683175752 | 0 |
| zed-pkg-test/atto-ci | 44683179241 | 0 |

All eight jobs completed as **failed before any step** with no
runner assigned. That does **not** establish the underlying reason:
billing/minutes, workflow permissions, policy, platform scheduling
and other admission failures remain possible. It does establish that
none of the tested carriers has demonstrated capacity to run the
required mirror. The conformance ledger records each run ID
without upgrading any backend to a passing status.

**Secure mirror admission protocol**: (1) verify that the alternate
carrier is private, authorized to hold the source, and successfully
executes a nonzero-step canary; (2) pin the immutable source PR
commit SHA and read its complete recursive Git tree, including
file mode, symlinks, executable bits and non-text blobs; (3) via
the GitHub connector copy the actual source blobs into the carrier,
checking the exact Git blob hashes; (4) construct and commit a
mirror tree, verifying the source and carrier tree SHA and exact
file modes, with fail-closed behavior for submodules or unsupported
entries; (5) run Actions on that local carrier checkout using only
the carrier repository's own `GITHUB_TOKEN`; (6) preserve
artifact hashes, process exit and result ABIs, toolchain versions,
exact head and CI steps in the ledger. Never silently substitute a
text-only approximation for a full binary Git tree.

Because **step 1 did not pass**, no private source tree was mirrored
or checked out cross-organization during this pass.

## Scalar authority word hardening

JavaScript, Forge C++, Cranelift Rust, .NET CIL and Java scalar source
frontends now all reject `sync`, `task`, and `yield` as
callable, argument-binding or local-binding names. Each of the five
restricted compiler PRs has nine additional negative test cases;
these tests are authored but only the JavaScript compiler's
current source blob has been exercised in a V8 smoke harness.

The **current** JavaScript source compiler Git blob
`1dba4620bbacfb78086974c5da86eee87ca0bbbf`
successfully generated and executed seven spec programs in-process
with values `83/83/42/42/61/42/i64::MIN`, trapped checked overflow,
rejected seven pinned invalid fixtures, and rejected nine
`sync/task/yield` binding variants. This is not a Node child process,
GitHub Actions, or proof of secure tenant isolation. Previous
JVM/native/Node local receipts are retained as historical evidence
with explicit stale-compiler SHA markers after these source changes.

**Remaining gates:** executed end-to-end Node ESM CLI, Forge
GCC/Clang CMake/CTest + sanitizers, Cranelift native JIT, .NET
CoreCLR/NativeAOT, Java JDK25/GraalVM Native Image,
Rust browser/Wasm and LLVM native emitters, plus independent
security/ownership/effects validation in the production compilers.


## 2026-11-20 exact-head and receipt-admission hardening

The ledger contains **16 execution/release profiles across all 11 \`atto-source.*\` repositories**.
A profile is not synonymous with a repository: Rust and LLVM have multiple
independent execution paths, Java has bootstrap and production paths, JS has
compiled-ESM and runtime paths, and the browser has a separate pinned release.

Current source PR SHA references for .NET, Java, Forge, Cranelift and JS were
refreshed from their GitHub PR-head readbacks. This does **not** promote tests:
all profile \`execution_status\` values remain \`not_executed\`, all receipts
remain null, and the supplemental edge suite remains unqualified.

Local historical Java/JVM, Forge/C++ and JS/V8 execution observations are
**quarantined from current-head parity claims**: their recorded compiler Git
blob differs from the actual compiler blob at the now-proposed PR head.
Those local test observations remain useful for debugging their previous
revision, but must be repeated on each current exact source tree.

The admission test now requires an **exact 16-profile / 11-source-repository
inventory**, and a claimed \`passed\` receipt must additionally bind
\`compiler_repo\`, \`compiler_head_sha\`, \`compiler_tree_sha\`, GitHub
\`run_id\`, \`job_id\`, \`run_attempt\`, a nonzero assigned \`runner_id\`,
real completed successful step entries, and the exact GitHub source-repo
run/job URL. A verified artifact must have a nonzero artifact ID, the
same-run artifact URL and a SHA-256 ZIP digest. The test includes 18 negative
mutation probes of these new provenance checks.

**Crucial limitation:** a static ledger cannot independently authenticate
self-reported GitHub run steps or an artifact digest. The independent
qualifier must inspect the actual GitHub job API, download the artifact,
verify the ZIP hash, check compiled outputs and the eight source-negative
absence checks against the exact SHA/tree, and only then allow a reviewer
to mark the target \`passed\`. A synthetic, source-free or historical
execution cannot qualify a compiler. The source-repository-only URL check
is intentionally fail-closed; carrier receipts need separately approved
export/destination policy and a distinct validated evidence contract.

Atto GitHub Actions were recently returning failed zero-step runs; no
new compiled-guest CI evidence was produced by this metadata hardening.
