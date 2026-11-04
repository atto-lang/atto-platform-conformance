# Java ⇄ LLVM critical/suspends M0 — exact-head promotion boundary

Date: November 3, 2026. **This is a source audit and evidence-classification
record, not runtime parity or permission to export confidential code.**

| Backend | PR and exact source head | Git root tree | Hosted stepful evidence |
| --- | --- | --- | --- |
| Java/Graal | [source.java #2422](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2422) `892c3220dbc22ae7138d3141e13ea46404430db4` | `01644d97450817417569cdc359826f9cc04b09ee` | [run 41755226023](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41755226023): zero steps, `NOT_EXECUTED` |
| LLVM | [source.llvm #1277](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1277) `a94d61807e6eb7800cfa1e9ca2a7f25c4cce8004` | `70bae8a10c89b66090c2f0bd89407fb437fda69c` | [run 41754620114](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41754620114): zero steps, `NOT_EXECUTED` |

## Source changes currently authored, not executed in hosted CI

**Java:** `CheckedTaskCaptures` now requires successful independent typing
and its exact generation even for a noncritical Task; the checker must
complete ownership analysis and mint a Program/epoch-bound private authority.
Legacy host-only Task publisher rejects. A new weak Program-identity typing
ledger invalidates stale Task captures after successful or failed retyping.
Three new JUnit cases cover untyped Task denial and both recheck outcomes.
Two additional Java guest JUnit cases use committed canonical `.atto`
counterparts of the legacy `.ores` actor fixtures, with separately checked
outputs `42` and `returned`. The explicit MIME/source text path does not
by itself prove a full `.atto` CLI/import migration.
Seven Surefire suites and named negative and `.atto` guest cases are
required by focused CI.
The critical-only actor path remains admitted without requiring a nonempty
Task capture ledger.

**LLVM:** the actual native compiler is targeted by a test harness covering
13 fail-closed negatives under both `.atto` and legacy `.ores` filenames,
two positive scalar LLVM IR compilations, denial of emitted IR/object
artifacts from rejected source, and concrete `.atto` fixtures.
The native critical gate now returns ordered retirement cancellation receipts,
fences scope-ID overflow, offers atomic `retire_if_quiescent`, and has 256
release-vs-retirement plus 256 request-vs-empty-retirement race iterations.
These are **host-only substrate/tests**; the LLVM compiler still rejects
unlowered canonical `critical` source rather than executing it.

## What would promote a case to PASS

1. Record nonzero executed workflow steps and an exact source head, Git tree,
   compiler binary SHA and test fixture identity. A zero-step workflow remains
   `NOT_EXECUTED`, never FAIL or PASS for compiler/guest behavior.
2. Compile source through each backend's actual compiler. Require exact
   diagnostics and no emitted artifact for rejected sources. A Java parser
   success or C++ host gate is not LLVM guest execution.
3. Run the canonical actor fixtures and independently establish exact stdout
   `42` and `returned`, FIFO handoff, actor incarnation checks, cancellation
   delivery, retirement, and physically completed cleanup. Run the LLVM
   compiled guest rather than a C++ host stand-in.
4. Keep `.atto` naming/admission, legacy `.ores` compatibility, Java
   JVM-hosted Truffle execution and Native Image AOT as **separate evidence**.
5. Reconcile overlapping LLVM drafts [#1289](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1289)
   and [#1290](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1290)
   before promoting or merging #1277; test any semantic conflict.

## Security hold

The source org's `main` protection and the independently approved
cross-organization source-export policy are not established. Do not mirror
private source to the separately tested `gha-indie-worker` carrier solely
because its source-free Java 21 probe ran. The destination allowlist is
empty, no independent `ORESoftware` approval is submitted, and the
existing security record is [Java issue #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962).

**Backend case status:** Java restricted actor candidate: authored/unverified.
LLVM `critical` compiler admission: source-only fail-closed tests authored.
LLVM guest critical execution: **NOT_IMPLEMENTED**. Both hosted exact-head
workflows: **NOT_EXECUTED**. No complete Java⇄LLVM guest parity claim.


## Additional LLVM reconciliation — current exact-head status

This LLVM head now integrates **selected** compatible changes from draft
`#1289` and `#1290`, but leaves both companion drafts open pending
independent conflict review:

- Critical callbacks: reject inferred Suspend, Io, Block and unaudited FFI
  effects even if a trusted actor generation or continuation fence exists.
  The host-only contract tests cover individual and mixed effect rows.
- LogicalMutex: guard callback entry with active ticket identity, block early
  release after STOP, disallow unverified borrowed/aggregate callback returns,
  and expose atomic quiescent retirement with the same lock order.
- CriticalGate: retirement preserves the physical owner until release while
  refusing any new guest admission. FIFO waiting-ticket cancellation receipts,
  scope overflow fencing, 256 release-vs-retire and 256 request-vs-empty-
  retirement races are authored in the native host tests.
- LLVM compiler: code-labeled `E_CALLABLE_MODIFIERS` and
  `E_CRITICAL_UNSUPPORTED` fail-closed diagnostics for both modifier orders,
  actor methods and standalone critical declarations. CMake registers the
  compiler negative/positive suites and a seven-case host scalar copy-out
  compile-negative suite.
- `source-actor-send.atto` now participates in the real LLVM compiler →
  Clang native runtime → actor scheduler/STOP e2e driver, alongside
  `source-actor-send.ores`. This **ordinary actor** fixture is an authored
  native guest baseline; it does **not** include or validate a critical block.

**29/29 source-structure assertions** matched the intended current branch
changes. These are not CTest or guest-execution receipts. Exact-head source
organization [LLVM run #41766324465]
(https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41766324465)
still failed without allocating a runner (`steps=null`, `NOT_EXECUTED`).

A distinct **source-free** C++17 proof did execute in the alternate
organization: [carrier PR #45]
(https://github.com/gha-indie-worker/gha-indie-worker-docs/pull/45),
[run #41765967238]
(https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41765967238)
**seven successful job steps** with GCC 15.2.0, Clang 21.1.8 and ASan/UBSan
on both compiled standalone generic canaries. It performed no checkout
and transferred **zero private source**. It is a toolchain/budget availability
receipt, never the LLVM source build receipt or permission for private mirroring.

**Promotion stays denied:** source org protections, independent review and
numerically approved carrier allowlist absent; no genuine LLVM critical guest
lowering/execution, JUnit, native codegen, sanitizers against the source
head, or `42`/`returned` native critical guest parity can be claimed.


The latest exact LLVM head `a94d61807e6eb7800cfa1e9ca2a7f25c4cce8004` has native/compiler workflow #41766324465 failing with zero steps and no runner. This is NOT_EXECUTED, while source-free alternate run #41765967238 has seven executed sanitizer toolchain steps.
