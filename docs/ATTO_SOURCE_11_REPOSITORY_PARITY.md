# Atto source-repository parity inventory (11 repositories)

**Status: AUDIT BASELINE ONLY — NO COMPILER/GUEST PARITY CERTIFIED.** Captured 2026-11-21. The machine-readable inventory is [atto-source-repository-parity-audit-v1.json](../contracts/atto-source-repository-parity-audit-v1.json). Every source baseline SHA was read from the authenticated GitHub `main` branch endpoint during this audit, but a commit recorded then may become stale immediately. Re-read source and merge-group SHAs for each actual test or merge.

## Coverage boundary

The eleven `atto-lang/atto-source.*` repositories are: `.atto`, `.net`, `.hdl`, `.java`, `.realtime`, `.rs`, `.llvm`, `.js`, `.forge`, `.wasm`, and `.cranelift`. Do not omit self-hosting or realtime source repositories simply because a historical nine-backend contract omitted them. This inventory deliberately records unknown capability profiles rather than assuming that restricted RTL, realtime and self-hosted profiles expose all general-purpose language/runtime features.

The previously authored [value blocks/ranges inventory #501](https://github.com/atto-lang/atto-platform-conformance/pull/501) is a **historical legacy Oreslang-source snapshot**, with nine backend rows and ten guest lanes. Its old immutable blob/source pins must not be silently relabeled as current Atto compiler receipts. [Ref32 growth #461](https://github.com/atto-lang/atto-platform-conformance/pull/461) has a different feature-specific seven-implementation heap gate and eleven NOT_EXECUTED hybrid compatibility statuses. Retain both narrower contracts. This inventory is independent of their exact source and feature-specific contracts.

## Audited source-tree boundary (2026-11-21 historical snapshot)

Each real **root Git tree SHA** was read from the authenticated
`branches/main` commit object's `commit.tree.sha`, then verified using
`git/trees/{root-tree-sha}?recursive=1` with `truncated=false` and an
exact count of blob entries. **Do not use `git/trees/main`'s returned `sha`
as the root tree OID**: the branch-ref alias can appear as the commit SHA.
These are **historical source inventory
facts**, not compiler parity tests; the source head can change after capture.

| Backend | Main Git blob files observed | Implementation-stage evidence |
| --- | ---: | --- |
| `.atto` self-hosted | 2 | README and AGENTS only: bootstrap, no runnable self-hosted compiler on `main` |
| `.realtime` | 2 | README and AGENTS only: bootstrap, no runnable real-time compiler on `main` |
| `.hdl` | 57 | Source/scripts/fixtures present; RTL guest execution **not** certified |
| `.cranelift` | 221 | Source present; JIT guest execution **not** certified |
| `.forge` | 332 | Source present; native compiler guest execution **not** certified |
| `.js` | 378 | Source present; JavaScript guest execution **not** certified |
| `.wasm` | 699 | Source present; Wasm guest execution **not** certified |
| `.net` | 1,075 | Source present; CIL/NativeAOT guest execution **not** certified |
| `.rs` | 1,169 | Source present; native or browser-Wasm guest execution **not** certified |
| `.java` | 2,882 | Source present; JVM/GraalVM guest execution **not** certified |
| `.llvm` | 3,063 | Source present; native LLVM guest execution **not** certified |

The machine-readable inventory pins all eleven historical root Git tree OIDs
and expected nontruncated blob counts, explicitly records
`BOOTSTRAP_DOCUMENTATION_ONLY` for `.atto` and `.realtime`, and fails closed
if a source-only inventory is relabeled an executable guest certificate.

The registry now includes **14 explicit feature families × 11 backends =
154 required feature/backend applicability-and-evidence decisions**.
Every one of the **154 explicit `feature_backend_cells` entries** begins `NOT_VERIFIED` in this snapshot; the machine-checkable table rejects omitted backends, invented unsupported claims, forged passes and dropped feature families. These decisions cover
lambda delimiters, dual-form exceptions, `maybe`/Option/Result, ownership,
sealed actor state, typed pubsub, scalar syntax, Ref32 actor memory,
Theater/Director/Ensemble/Runtime, immutable collections, checked arithmetic,
static ascription/generic inference, Unicode/control-byte admission, and
package/import/AOT profiles. **A source-tree inventory is not one of the 154
guest-pass proofs**; code-source presence and baseline CI never certify guest
semantics. A bootstrap-only backend requires completed implementation or an
explicitly justified, compiled negative unsupported-profile rejection.

**Scope priority:** use the existing source PRs and shared conformance before
opening overlapping implementation branches. The planned Theater/Director/Ensemble
guest contract is [conformance #551](https://github.com/atto-lang/atto-platform-conformance/pull/551);
11-backend readiness must be evaluated there per target. Borrow admission,
hybrid Ref32 actor memory, language syntax and scalar/checked-i64 projects
have separate active PRs. This all-repository inventory must never replace
their feature-specific acceptance oracles.

**CI admission:** the observed runs for the inventory and Theater contracts
had no recorded runner steps when checked; those are `NOT_EXECUTED` for
material tests, not failed compiler code. Inspect original job records and
explicit admission reasons before concluding exhausted Actions minutes.
Off-host source-free GitHub connector diagnostics may proceed, but moving
this private conformance repository or private compiler trees to a carrier
requires a *separate effective source-to-destination security authorization*.
No valid authorization means no cross-org private tree copy.

## First concrete feature lane: exceptional bang control

The [canonical 18-vector source-only spec](https://github.com/atto-lang/atto-spec/pull/146) specifies the contiguous `trap!`, `throw!`, `raise!`, `panic!` spellings and lexical collision boundaries. The pinned 11-row [implementation ledger](../contracts/exception-control-bang-source-audit-v1.json) references the existing draft PR in **every** `atto-source.*` repository.

Eight repos contain actual lexers/parsers and now have expanded source-level regression tests: `.java` #194, `.llvm` #293, `.rs` #449, `.net` #119, `.js` #73, `.forge` #106, `.cranelift` #73, `.hdl` #21. Java and Rust/LLVM Rust admit lexical spellings; other restricted engines deliberately reject unlowered exceptional effects instead of executing host errors or generating invalid guest artifacts. LLVM's C++ exceptional-control guard now also recognizes `trap!` as an unsupported checked effect. This is **partial lexical/admission alignment**, not typed Result/throw/raise/panic runtime parity.

`.wasm` #119 is a **delegated compiler**: source-to-Wasm goes through `.rs`, not an independent second source compiler in its host repository. `.atto` #13 and `.realtime` #6 contain draft source-only documentation but **no compiler implementation on main** at the captured baseline. Do not invent a native guest PASS for these profiles.

Executed limited host-side checks in an isolated V8 harness against the actual fetched source functions: JS scalar lexer 18/18, JS program-v2 tokenizer 18/18, HDL lexer 18/18 and full HDL parsing/RTL generation boundary 18/18; both complete JS source compilers also denied four unsupported effects and compiled a comment-only scalar smoke source (10/10 focused cases). These are **not** compiler Actions, Rust/Java/.NET/C++ build passes, Wasm32/RTL simulator proof, or runtime supervisor semantics. The exact-head source GitHub Actions workflows failed before executing any steps (runner-admission cause not yet independently established), and this ledger records all eleven as NOT_EXECUTED.

The first substantive completion sequence is: reconcile spec/formatter #146, validate executable compiler behavior on exact source SHA, implement typed Result and Error payload/unwind/actor CONTROL semantics where supported, require a diagnostic/no-artifact witness for unsupported target profiles, independently verify execution receipts, and only then promote evidence per backend.

## Control-loop and actor Ref32 parity lane (2026-11-21)

[11-backend control/actor memory evidence ledger](../contracts/control-actor-memory-11-backend-audit-v1.json) extends the historical source inventory **without changing its original Git baselines**. It pins existing candidate PR heads for actor-memory work and the newly added **separate bounded native control-plane** pilots in [Java #1273](https://github.com/atto-lang/atto-source.java/pull/1273) and [.NET #173](https://github.com/atto-lang/atto-source.net/pull/173).

Both pilots use a four-byte `control_generation12_slot20_v1` control-heap field with host-only issuer-qualified witnesses, an unmanaged record and slot table, bounded admission, stale-generation/STOP rejection, explicit scrub and disposal, and typed i64/two-i64-limb/Ref32 field operations. They **do not** yet replace the full scheduler/control loop, and their source-workflow compiled tests remain **NOT_EXECUTED** until a nonzero-step test actually runs. The Java/.NET source organization policy presently has **zero approved private CI destinations**, so their code must **not** be copied to the private alternate runner without separately effective authorization. A valid private CI carrier for a source-free spec contract does **not** authorize transferring private Java/.NET compiler files.

**ABI separation is mandatory.** `offset8_plus_one` is a compressed actor-relative direct offset; `generation20_slot12` is a Java/LLVM actor-host prototype encoding; `generation16_slot16` is a .NET actor-guest candidate. The new control-plane `control_generation12_slot20_v1` is a distinct typed domain/ABI even though it shares a slot/generation split. Equal numeric words from actor and control domains convey no authority. Compiler-/runtime ABI mismatch rejects admission instead of reinterpreting bytes; 32 GiB direct-offset reach must not be attributed to a slot-handle encoding.

**LLVM host implementation evidence:** The existing [LLVM #742](https://github.com/atto-lang/atto-source.llvm/pull/742) now also contains the separately bounded native C11 control heap with the same `control_generation12_slot20_v1` ABI. Its exact C/header/test Git blobs were verified against the local source; on Linux x86-64 GCC 14.2 `-O2 -Werror` and Clang 17 `-O1 -fsanitize=address,undefined` **both compiled and executed the 12-scenario native control test successfully** after an explicit non-elidable volatile-scrub hardening pass. The source Git blob for `ControlPlaneArena32.c` is `ff66f2be47a50373e88b7d4e66b4d35f396bc0c5`. This is a **host-native-only local test**, not the complete LLVM Atto guest or root scheduler; source Actions and exact-head CI still require independent nonzero-step verification.

Other active actor-memory branches remain independent: [LLVM #742](https://github.com/atto-lang/atto-source.llvm/pull/742), [Wasm #221](https://github.com/atto-lang/atto-source.wasm/pull/221), [Forge #166](https://github.com/atto-lang/atto-source.forge/pull/166), [Rust #502](https://github.com/atto-lang/atto-source.rs/pull/502), and [JS #117](https://github.com/atto-lang/atto-source.js/pull/117). `.cranelift` and `.hdl` still need target-specific memory admissibility assessment; `.atto` and `.realtime` are bootstrap-only in this snapshot. Neither source existence nor a host-memory smoke implies general compiled actor guest support. All eleven rows remain `NOT_EXECUTED` for guest allocation, deterministic control-plane integration and managed hot-path measurements.

**Correct bit allocation:** the control ABI name is `control_generation12_slot20_v1` because bits 31..20 are the 12-bit generation and bits 19..0 are the 20-bit slot+1. The earlier reversed draft label `control_generation20_slot12_v1` is rejected; the actual four-byte layout did not change. The .NET implementation independently corrected its constant and boundary vectors; Java/LLVM now match it exactly.

### Incremental control Ref32 representation parity (seven source repositories)

As of this audit, **seven** existing backend PR branches have a typed control-plane storage implementation or codec using `control_generation12_slot20_v1`, distinct from their actor-relative object references:

- Java/GraalVM [#1273](https://github.com/atto-lang/atto-source.java/pull/1273): bounded native FFM control arena, Java test source authored; JVM/Graal exact-head execution and zero-managed-allocation claims unverified.
- .NET NativeAOT [#173](https://github.com/atto-lang/atto-source.net/pull/173): `NativeMemory` control arena and probe source authored; actual CLR/NativeAOT source CI remains unverified.
- LLVM [#742](https://github.com/atto-lang/atto-source.llvm/pull/742): native C11 control arena, exact Git blobs independently exercised locally with GCC 14.2 optimized build and Clang 17 ASan/UBSan. Host-native-only proof, no .atto guest compilation.
- Rust frontend [#502](https://github.com/atto-lang/atto-source.rs/pull/502): `src/control_ref32.rs` with three unit-test cases and export from `src/lib.rs`; Rust executable test **NOT_EXECUTED** because no authorized current-head runner/compiler was available for this validation.
- JS [#117](https://github.com/atto-lang/atto-source.js/pull/117) and Wasm [#221](https://github.com/atto-lang/atto-source.wasm/pull/221): byte-identical source and test Git blobs for the host-only control word codec (`d9e7a30217b2fe5c17d6794aa40a7b26f7f4a311`, `474f5d7b4f0fc8142f497f0acdd4d050c17306b5`). Four Node 22.16.0 host tests passed locally. No compiled actor guest claim.
- Forge [#166](https://github.com/atto-lang/atto-source.forge/pull/166): C++20 codec `6c6e32aed6540233be306114dbb9abfddcee10c3`, test `b351175cdc7e9e8d052eb889ad2c9f1978bb1115`, compiled and run locally with GCC 14.2 optimized and Clang 17 ASan/UBSan. Registered in Forge CTest but full Forge build/guest not proved.

The new [six-vector ABI oracle](../contracts/control-ref32-bit-vectors-v1.json) and [negative-mutation Node test](../tests/control-ref32-bit-vectors-v1.test.mjs) passed **3/3 local host-only tests**; those source blobs were verified as `e2c9ae4d4e2d0da7154b06232bb6b93edd80f9bd` and `b37f2fa1e5adc6452d32526a0fba59c33247b316`. Every one of the eleven rows still has `control_plane_compiled_atto_guest: NOT_EXECUTED`. The other four repositories (`.cranelift`, `.hdl`, `.atto`, `.realtime`) have no newly certified control codec or actor guest. A numeric word or successful host codec is never an issuer/owner capability.

**CI recovery:** the previous existing private carrier `ores-data-platform/atto-ci` accepted exact-blob updates but its later job [#44951561361](https://github.com/ores-data-platform/atto-ci/actions/runs/44951561361) executed **zero steps**. A new **source-free, no-private-export** canary ran successfully in independent `file-tunnel-test/atto-ci`: [Actions #44951900531](https://github.com/file-tunnel-test/atto-ci/actions/runs/44951900531), three successful job steps. This demonstrates carrier runner admission for that canary only. It is **not** approval to copy private Java/.NET/Rust/JS/Wasm/Forge/LLVM source. Source-specific effective export allowlists and independent approval remain required before any private cross-org Git-tree mirror. A source-free test or token-free Git blob match never satisfies a production guest CI gate.

The feature's executable target is [Atto spec #91](https://github.com/atto-lang/atto-spec/pull/91) and [hybrid heap conformance #461](https://github.com/atto-lang/atto-platform-conformance/pull/461); neither bypasses exact-current-head compiled guest/NativeAOT, safety, GC/RSS instrumentation and STOP/cancellation tests. The control-ledger Node test only asserts metadata integrity and rejection of forged completion.

## Runtime CONTROL root integration — Java and .NET source-authored (2026-11-21)

The **existing** [Java actor-native integration PR #1273](https://github.com/atto-lang/atto-source.java/pull/1273) and [.NET guest-heap PR #173](https://github.com/atto-lang/atto-source.net/pull/173) now contain opt-in, **actual host ActorRuntime** control-root lifecycle wiring; they are not merely standalone allocators. They do **not** replace the runtime-managed actor registries, mailbox byte arrays, scheduling delegates, or per-turn host objects.

- **Java/GraalVM:** supervisor opt-in `enableNativeControlCounters()`; FFM 32-byte record plus 12-byte native metadata, 44 explicitly charged aggregate bytes; atomic actor reservation, admission rollback, physical deregistration and quiescent shutdown publish a bounded native i64 summary. JDK25 JUnit spawn/STOP test and workflow authored, not executed.
- **.NET NativeAOT:** opt-in `UseNativeControlCounters`; 32-byte record plus padded 16-byte metadata, 48 actual native bytes subtracted from actor budget at construction; native live-actor and monotonic completed-message summaries updated on real Spawn/dispatch/FinalizeCell paths. CLR test plus Linux NativeAOT runtime-host publish/run workflow authored, not executed.
- **Security:** distinct issuer-qualified root capability, separate actor/control ABI, no actor-guest access to raw control words, no root memory free before observed actor/carrier quiescence, no late-update use-after-free after shutdown admission sealing. These are source implementation intents pending executable race, cleanup, error-injection and sanitizer evidence.
- **No parity promotion:** the eleven-source ledger still marks Java and .NET guest control-memory execution and measured scheduler-wide zero managed allocations `NOT_EXECUTED`; LLVM's existing GCC/Clang runs remain host-native-only, while the existing JS/Forge/Wasm codec receipts are scoped separately. The two bootstrap-only sources and remaining engines are not treated as implicit implementations.

**CI security:** Java and .NET private-source destination allowlists currently have no effective approved cross-organization CI carrier. Their code must not be mirrored to a different private org without separately approved destination authorization. A zero-step failed source Action is `NOT_EXECUTED`, never a compiler failure or a PASS. Preserve the current source PR heads and exact Git blob identity when testing.

### Issuer exhaustion, non-elidable native scrub and CI carrier admission

The control witness issuer is a **non-recycling unsigned 32-bit process-local identity**. Atto runtimes must reserve issuers with saturating CAS and permanently refuse new domains after the maximum issuer; allowing a wider backing counter to wrap would undermine foreign-domain/ABA rejection. The same boundary policy is implemented in Java [#1273](https://github.com/atto-lang/atto-source.java/pull/1273), .NET [#173](https://github.com/atto-lang/atto-source.net/pull/173), and LLVM [#742](https://github.com/atto-lang/atto-source.llvm/pull/742).

- **LLVM native host: executed locally on exact Git blobs** `ControlPlaneArena32.c=7f0fe65ac32f207db88f2af0043553e74f23f37f`, `ControlPlaneArena32.h=c2cd3e1331ff8d328c024995efa2bae673122187`, `control_plane_arena32_test.c=3afe81a79d6ecd8ef2a5a0ae1e00a3e4a4167d5d`; five optimized GCC 14.2 plus five Clang 17 ASan/UBSan tests passed, including boundary issuers and the existing concurrent 128-bit/scalar stress. Source native-control [GHA #44955742400](https://github.com/atto-lang/atto-source.llvm/actions/runs/44955742400) executed **zero steps**.
- **Java and .NET: source-authored, NOT_EXECUTED** on actual JDK 25 and CLR/NativeAOT. Their new tests use synthetic per-call issuer counters, not the process-global production issuer. The .NET runtime additionally uses `CryptographicOperations.ZeroMemory` for native record reclamation and the **entire aligned slot table** at shutdown, but NativeAOT executable wiping/GC evidence is still pending.
- **Alternate CI attempts:** the fresh **source-free** `usa-acc/usa-acc-e2e` [#44955812942](https://github.com/usa-acc/usa-acc-e2e/actions/runs/44955812942) and `opto-sync-test/go-java-validation` [#44955824813](https://github.com/opto-sync-test/go-java-validation/actions/runs/44955824813) probes also failed before any step. The other previously tested private carriers likewise had zero-step failures. These demonstrate runner admission failure, *not* compiler test failure or a verified amount of remaining Actions minutes. For private LLVM, [security issue #233](https://github.com/atto-lang/atto-source.llvm/issues/233) records the independently required **exact-head/tree and destination-ID authorization**, with the newest head superseding prior pins. No private source transfer occurred.
- **Parity scope remains unchanged:** seven control representation prototypes, three coherent i128 host implementations, **zero of eleven compiled Atto guests certified**. Numeric Ref32 identity, a source-free model, and a successful host-only native probe cannot establish guest authority or process-wide zero-GC.

### Coherent 128-bit values behind control Ref32 — executed scope

The control locator remains a **four-byte word**. A typed 16-byte scalar uses a low and high 64-bit limb, little-endian, and a full-width read/write must be non-torn under concurrent access. This is *separate* from the actor guest reference encoding, and all guest authority/issuer/epoch checks remain mandatory.

- **Java JDK25 / GraalVM [#1273](https://github.com/atto-lang/atto-source.java/pull/1273)**: bounded FFM control heap now has one-monitor `writeI128/readI128` with caller-owned reusable output storage; `ActorRuntime` publishes completed mailbox messages in native field 8 and exposes a coherent two-counter snapshot. JUnit exercises real spawn/send/completion/STOP and a warmed no-managed-allocation snapshot assertion. **Authored but NOT_EXECUTED** on exact head; actual compiler-generated actor guest and Graal Native Image are not certified.
- **.NET CLR / Linux NativeAOT [#173](https://github.com/atto-lang/atto-source.net/pull/173)**: bounded `NativeMemory` control heap has one-gate `WriteI128/ReadI128` with stack/value outputs, and `ActorRuntime.ReadNativeControlSnapshot()` returns a value tuple across actual host spawn/dispatch/STOP counters. Probe includes competing 32,768 writes/reads plus warmed 8,192-operation zero-CLR-allocation assertions, and source-native allocation padding is scrubbed in full. **Authored but NOT_EXECUTED**; no nominal `.atto` guest NativeAOT proof.
- **LLVM native C11 [#742](https://github.com/atto-lang/atto-source.llvm/pull/742)**: synchronized `atto_control32_write_i128/read_i128` with output alias/foreign/stale rejection and 32,768-reader/32,768-writer non-tearing test. The test and native code's exact Git blobs were compiled/executed locally with **GCC 14.2 -O2 -Werror** and **Clang 17 ASan/UBSan**; **both PASS**. The current header/C/test SHA identifiers are `3cef257d752b28c8031ca2b9a205b2b85222513a`, `1383ed7ab4607d62a3f7ad0a12761e61bc735dcd`, and `aaf3582c2252c68bd456a6d66acbab06b73b0599`. This is **native host execution only**. Source GHA #44953556642 failed before executing steps; no compiled `.atto` guest proof.
- **All remaining eight backends** retain `NOT_IMPLEMENTED_OR_UNVERIFIED` for this narrower control-scalar capability. All **eleven** compiled guest i128 receipts remain `NOT_EXECUTED`, and neither a coherent host snapshot nor quiet collector is whole-runtime zero-GC proof.

The [memory ledger](../contracts/control-actor-memory-11-backend-audit-v1.json) and its mutation tests pin the evidence without promoting authored tests to PASS. The core remaining implementation gate is compiler-typed `.atto` actor-local 128-bit field lowering plus actual JVM/Native Image/NativeAOT guest execution and per-turn allocation measurements.

### Canonical Atto actor guest and live alternate CI admission — 2026-11-21

- **LLVM native host, actually executed:** exact source Git blob `1fd941af03831b621b83cdd36d948766cfe2770e` adds a deterministic **50,000-operation** native lifetime model with allocation/reuse, stale/foreign-domain rejection, bounded quota, full 128-bit payload checks and retirement. GCC 14.2 `-O2 -Werror` and Clang 17 ASan/UBSan passed once at build and **12 additional process executions each** (13/13 per compiler); executable SHA256 GCC `548087766554732b110ff6f34dc49fa1443bb667ddebabaed51ce81ff7431a85`, Clang `6e5539d7eb4433c57e8a5951d5c62410b34a8626434726f31bcc8ca392a8a3c4`. This remains an unmanaged C **host test**, not generated Atto guest.
- **LLVM canonical compiled-actor candidate, NOT_EXECUTED on current head:** `tests/fixtures/source-actor-two-owned-heaps.atto` has exactly the same Git blob `cce7728c1682bbf2600af65d6ceda9071fe7aa0a` as its legacy `.ores` sibling. The existing real compiler/Clang source-actor harness is extended to compile, link, execute, and validate the `.atto` guest in both native and ASan/UBSan profiles. The workflow demands distinct success markers and exact fixture SHA equality. No runnable LLVM source-compiler CI/guest binary result was obtained on this PR head, so **no new guest parity pass** is recorded. The source actor uses `ActorOwnedI64Heap`, **not** the separate `ControlPlaneArena32` API, and does not prove guest control-domain i128 lowering.
- **Live public alternate-org capacity: verified** [gha-indie-worker/gha-indie-worker-e2e run #44957101583](https://github.com/gha-indie-worker/gha-indie-worker-e2e/actions/runs/44957101583) completed **three successful executed job steps**, including compiling and running a public/source-free C11 width model with both GCC and Clang. **No private compiler source was copied.** A separate same-organization **private** candidate [gha-indie-worker/atto-ci run #44957202225](https://github.com/gha-indie-worker/atto-ci/actions/runs/44957202225) failed before executing steps. Public runner capacity cannot be used as proof of funded private capacity or source-transfer authorization.
- LLVM source head `5ca234e3637dd3c3c00093c8c78c63f898d470c9`, Git root `0876a80e4702529583ff7d919202a5ed766da5eb`; **1,824 blobs**, 91 trees, untruncated, no symlinks or gitlinks. Exact private tree mirroring still requires independent authorization of *this* source head/tree + destination numeric ID; existing private carrier contracts do not authorize #742. [Source security issue #233](https://github.com/atto-lang/atto-source.llvm/issues/233) tracks the decision. Do not copy source to the working public carrier.

## Required completion per feature and backend

1. Confirm if the feature is supported by the backend's **defined capability profile**. For unsupported hardware/realtime/restricted profiles, require a real exact-head compiler rejection with the required diagnostic and no output artifact; a skipped job is not success.
2. Reconcile current Atto spec, formatter, borrow checker, CLI, the canonical legacy-to-Atto migration crosswalk, and relevant competing Ready/Draft PR patches before coding or merging. Prefer the existing implementation branch and preserve unique work.
3. Pin the current Atto source commit and Git tree; run actual frontend/compiler tests, negative permission/ownership tests and real native/AOT/browser/RTL guest execution appropriate to the profile. Distinguish an interpreter, Wasm wrapper, host JS oracle, provenance probe, and real compiled guest.
4. Independently verify GitHub Actions run ID, exact source/merge-group SHA, actual job/step execution, exit status, guest stdout/return/diagnostics and artifact digests. Current mandatory **source** checks and GitHub protection remain binding. An alternate-org run, if independently authorized and privacy-safe, is supplemental only.
5. Record one evidence receipt for each applicable feature/backend pair before asserting parity. No receipt exists in this baseline. Never promote an authored test, job name, or self-attested JSON receipt to verified execution without external checks.

Run the registry integrity and negative/adversarial tests with:

```sh
node --test tests/atto-source-repository-parity-audit-v1.test.mjs
```

**This executes only a source-free inventory validator. It cannot typecheck or run an Atto program.** Cross-organization private-source mirroring remains blocked without destination-specific confidentiality authorization and reviewed carrier policy; Actions minutes must not be inferred exhausted from a zero-step failure without its explicit admission reason.
