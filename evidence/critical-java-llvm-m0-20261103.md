# Java ⇄ LLVM critical/suspends M0 — exact-head promotion boundary

Date: November 3, 2026. **This is a source audit and evidence-classification
record, not runtime parity or permission to export confidential code.**

| Backend | PR and exact source head | Git root tree | Hosted stepful evidence |
| --- | --- | --- | --- |
| Java/Graal | [source.java #2422](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2422) `892c3220dbc22ae7138d3141e13ea46404430db4` | `01644d97450817417569cdc359826f9cc04b09ee` | [run 41755226023](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41755226023): zero steps, `NOT_EXECUTED` |
| LLVM | [source.llvm #1277](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1277) `e2bee2fc2d0a0ed9fb94c546deb14a8ab2c0b2af` | `353587df051611af16d707da62d876a6935cb7db` | [run 41754620114](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41754620114): zero steps, `NOT_EXECUTED` |

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
