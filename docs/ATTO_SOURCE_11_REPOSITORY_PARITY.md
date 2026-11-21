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

Both pilots use a four-byte `control_generation20_slot12_v1` control-heap field with host-only issuer-qualified witnesses, an unmanaged record and slot table, bounded admission, stale-generation/STOP rejection, explicit scrub and disposal, and typed i64/two-i64-limb/Ref32 field operations. They **do not** yet replace the full scheduler/control loop, and their source-workflow compiled tests remain **NOT_EXECUTED** until a nonzero-step test actually runs. The Java/.NET source organization policy presently has **zero approved private CI destinations**, so their code must **not** be copied to the private alternate runner without separately effective authorization. A valid private CI carrier for a source-free spec contract does **not** authorize transferring private Java/.NET compiler files.

**ABI separation is mandatory.** `offset8_plus_one` is a compressed actor-relative direct offset; `generation20_slot12` is a Java/LLVM actor-host prototype encoding; `generation16_slot16` is a .NET actor-guest candidate. The new control-plane `control_generation20_slot12_v1` is a distinct typed domain/ABI even though it shares a slot/generation split. Equal numeric words from actor and control domains convey no authority. Compiler-/runtime ABI mismatch rejects admission instead of reinterpreting bytes; 32 GiB direct-offset reach must not be attributed to a slot-handle encoding.

**LLVM host implementation evidence:** The existing [LLVM #742](https://github.com/atto-lang/atto-source.llvm/pull/742) now also contains the separately bounded native C11 control heap with the same `control_generation20_slot12_v1` ABI. Its exact C/header/test Git blobs were verified against the local source; on Linux x86-64 GCC 14.2 `-O2 -Werror` and Clang 17 `-O1 -fsanitize=address,undefined` **both compiled and executed the 12-scenario native control test successfully** after an explicit non-elidable volatile-scrub hardening pass. The source Git blob for `ControlPlaneArena32.c` is `ff66f2be47a50373e88b7d4e66b4d35f396bc0c5`. This is a **host-native-only local test**, not the complete LLVM Atto guest or root scheduler; source Actions and exact-head CI still require independent nonzero-step verification.

Other active actor-memory branches remain independent: [LLVM #742](https://github.com/atto-lang/atto-source.llvm/pull/742), [Wasm #221](https://github.com/atto-lang/atto-source.wasm/pull/221), [Forge #166](https://github.com/atto-lang/atto-source.forge/pull/166), [Rust #502](https://github.com/atto-lang/atto-source.rs/pull/502), and [JS #117](https://github.com/atto-lang/atto-source.js/pull/117). `.cranelift` and `.hdl` still need target-specific memory admissibility assessment; `.atto` and `.realtime` are bootstrap-only in this snapshot. Neither source existence nor a host-memory smoke implies general compiled actor guest support. All eleven rows remain `NOT_EXECUTED` for guest allocation, deterministic control-plane integration and managed hot-path measurements.

The feature's executable target is [Atto spec #91](https://github.com/atto-lang/atto-spec/pull/91) and [hybrid heap conformance #461](https://github.com/atto-lang/atto-platform-conformance/pull/461); neither bypasses exact-current-head compiled guest/NativeAOT, safety, GC/RSS instrumentation and STOP/cancellation tests. The control-ledger Node test only asserts metadata integrity and rejection of forged completion.

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
