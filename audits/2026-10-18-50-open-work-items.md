# Fifty unfinished Oreslang work items — 2026-10-18

Source: GitHub live open-PR search (`org:ores-truffle-oreslang is:open updated:>=2026-10-08`). Items were updated in the last ten days; some were originally opened earlier. This is a **triage and next-execution gate** artifact, not a claim that these 50 PRs were fixed or tested. Do not merge solely on this evidence.

**Snapshot:** 50 distinct open PRs, 10 repositories, 33 P0 and 17 P1. Original recovery pass hardened Zorde #25; a subsequent pass also committed a TaskScope concurrency fix on Java #1407. Neither has passing source-org compiler/runtime CI. All other entries remain triaged, not completed.

## Global admission rules

- No source Git-tree mirroring to cross-org runners without reviewed private destination identity, protected source provenance, exact tree pin, and explicit authorization. An available runner is not sufficient authorization.
- No bypasses, self-approvals, CI-only placeholders, or declaring green from host-only models.
- Preserve all existing branches, worktrees, commits and checkpoints; no force-push to source branches.
- Test exact-head SHA with stepful CI, real compiler/guest when relevant, adversarial regressions, plus independent review before merging.
- Sequence: security integrity → runtime ownership/cancellation → compiler/ABI parity → ecosystem integration.

## Work-item queue

| # | Priority | Live open PR | Next executable acceptance gate |
|---:|:---:|---|---|
| 1 | P0 | [oreslang-source.java #1367](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1367) — [DRAFT] Bounded logical actor proxy mailbox with upgrade watermark | Prove mailbox credit, monotone completion watermark, and upgrade freeze under out-of-order completion. |
| 2 | P0 | [oreslang-serialization-and-validation #25](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/25) — test(zorde): fail closed on unrelated private-visibility compiler diagnostics | Run 29 source-free denial-verifier regressions plus real native compiler privacy diagnostics; do not count source-free tests as guest execution. |
| 3 | P1 | [oreslang-source.java #1386](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1386) — feat(language): static signature spelling over module and class contracts | Run static-signature Java source typecheck and LLVM negative parity before merge. |
| 4 | P0 | [oreslang-source.java #1377](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1377) — Draft: introduce nb Task-block syntax and compiler admission gates | Compile positive/negative nb Task source fixtures; reject detached mutable borrow. |
| 5 | P1 | [oreslang-data-science #15](https://github.com/ores-truffle-oreslang/oreslang-data-science/pull/15) — draft(matrix): guard DenseMatrixF64 shape product and index overflow (#9) | Execute matrix shape overflow guest tests under exact-source Java compiler. |
| 6 | P0 | [oreslang-source.llvm #627](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/627) — [DRAFT] Compose actor code-generation gate with checkpoint transaction (host-only) | Prove actor-codegen checkpoint transaction and SelectPlan compile gates. |
| 7 | P0 | [oreslang-source.java #1361](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1361) — Security: pin complete source Git tree for private CI mirroring | Verify full source-tree digest with protected source policy; do not export private trees. |
| 8 | P1 | [oreslang-source.java #1397](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1397) — Audit owner-bound invocation IR: checked ABI source map and evaluation schedule | Prove call argument evaluation order and owner-bound ABI source mapping. |
| 9 | P0 | [oreslang-serialization-and-validation #24](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/24) — hardening(zorde): source-local compiler path and export-evidence controls | Fix native Zorde source-local runner contract, immutable compiler identity, evidence guard. |
| 10 | P1 | [oreslang-source.java #623](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/623) — Draft: nominal ADTs, exclusive match safety, exact-width guards and conformance (CI blocked) | Execute ADT exhaustiveness, overlap and exact-width tests rather than parser-only evidence. |
| 11 | P0 | [oreslang-source.llvm #652](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/652) — draft(native-ipc): bounded receipt correlation, rollback denials and terminal races (#79) | Test bounded authenticated receipt correlation, rollback denials and terminal races. |
| 12 | P0 | [oreslang-source.java #1401](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1401) — [ai-dev-loop] Fence actor leases and transact webhook admission and outbox claims | Prove lease takeover fencing and webhook/outbox transactions are atomic. |
| 13 | P0 | [oreslang-platform-conformance #107](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/107) — [ai-dev-loop] Replace two-step webhook admission with atomic transactional callback | Test rollback and concurrent webhook admission against real transactional store. |
| 14 | P0 | [oreslang-source.java #1373](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1373) — ci(java): immutable JVM OresMain bundle and hash-bound build receipts | Obtain verifiable exact-commit OresMain JVM bundle hash and stepful CI receipt. |
| 15 | P0 | [oreslang-platform-conformance #105](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/105) — Draft: Task block language conformance fixtures and parity gates | Keep runtimeVerified=false until Java and LLVM execute Task fixtures. |
| 16 | P0 | [oreslang-source.llvm #638](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/638) — merge(integration): conflict-resolved LLVM NIO + actor-turn parity on main | Reconcile NIO actor turn parity against current main and run target ABI checks. |
| 17 | P0 | [oreslang-source.java #1407](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1407) — feat(tasks): tracked TaskHandle with quiescent getDone (stage 2) | Test TaskHandle getDone only settles after physical task quiescence. |
| 18 | P1 | [oreslang-source.java #1335](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1335) — Stage fail-closed named/optional argument binding contracts | Exercise named, omitted, duplicate and nontrailing optional argument binding errors. |
| 19 | P0 | [oreslang-source.llvm #654](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/654) — audit(native): reject unlowered transport actor declarations before IR | Assert unlowered native transport actors fail before IR generation. |
| 20 | P0 | [oreslang-source.java #1406](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1406) — audit(actor): typed transport declaration matrix with fail-closed runtime gates | Execute typed HTTP/TCP/WS actor declaration and rejection matrix. |
| 21 | P1 | [oreslang-source.java #1408](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1408) — Audit scalar named-call projection: pin exact target and test all permutations | Test named-call single evaluation, exact target identity and permutation invariance. |
| 22 | P0 | [oreslang-source.java #1379](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1379) — Draft: awaitable OresTask<T> runtime handle and supervised detached execution | Wire Task<T> runtime, await result propagation, detach supervision and cancellation. |
| 23 | P0 | [oreslang-common-source #89](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/89) — draft(actor): executable source-free AOT/JIT hot-reload protocol and security gates | Require source-free AOT/JIT hot-reload protocol tests plus security review. |
| 24 | P0 | [oreslang-source.java #1396](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1396) — merge(integration): reconcile Java NIO actor Future/await with newer main semantics | Resolve Java NIO actor Future-await merge against current main; exercise real guest. |
| 25 | P0 | [oreslang-source.llvm #640](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/640) — Draft: reserve nb Task blocks and reject unsafe native lowering | Fail closed on nb Task lowering until native scheduler and continuation support exists. |
| 26 | P1 | [oreslang-format #78](https://github.com/ores-truffle-oreslang/oreslang-format/pull/78) — feat(format): preserve suspends callable effect alongside Task syntax | Run Cargo formatter idempotence tests; keep suspends distinct from Task creation. |
| 27 | P1 | [oreslang-source.java #1400](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1400) — Audit and harden literal named-call preflight with 15 regression tests | Run named-argument preflight regressions against actual parser/compiler. |
| 28 | P1 | [oreslang-source.java #1399](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1399) — feat(http): typed Oreslang HttpResponse bridge, affine HTTP/1.1 adapter and wire tests | Run HTTP/1.1 response adapter wire tests, response finalization and close races. |
| 29 | P0 | [oreslang-source.java #1270](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1270) — [DRAFT] Audit hot-loading: transactional publication, forged-unit gate, actor upgrade epochs | Prove atomic hot-load publication, forged-unit rejection and actor route epochs. |
| 30 | P0 | [oreslang-platform-conformance #57](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/57) — security(ci): gate all private source exports on protected-main exact-snapshot approval | Require reviewed protected-main approval before any private-source transfer. |
| 31 | P1 | [oreslang-source.java #1360](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1360) — feat(compiler): stage enum-based @CallerRole / @CallableBy admission | Reject forged or incorrectly scoped @CallerRole/@CallableBy annotations. |
| 32 | P0 | [oreslang-source.llvm #653](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/653) — Freestanding source actors: compiler ABI adapter and Cortex-M QEMU gate | Compile source actor ABI to Cortex-M and execute QEMU with no host libc. |
| 33 | P0 | [oreslang-source.llvm #629](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/629) — feat(freestanding): prototype bounded static actor kernel and host verification | Prove bounded static actor kernel and CONTROL scheduling without allocator. |
| 34 | P0 | [oreslang-source.llvm #580](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/580) — test(cortexm): source-compiled standalone ELF without libc runtime | Inspect Cortex-M ELF imports and run no-libc source-level guest in QEMU. |
| 35 | P0 | [oreslang-source.java #1402](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1402) — feat(tasks): structured cancellation ownership tree (stage 1) | Prove parent-child Task cancellation cascades and task shutdown quiescence. |
| 36 | P0 | [oreslang-platform-conformance #109](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/109) — draft(security): block unauthorized private carriers in 100-issue audit admission | Reject unauthorized cross-org private carriers; enforce destination review. |
| 37 | P1 | [oreslang-serialization-and-validation #21](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/21) — fix(validation): fail closed on nonfinite, noncanonical and oversized numeric lexemes | Execute JSON numeric grammar, infinity, underflow, and max-lexeme guest regressions. |
| 38 | P1 | [oreslang-serialization-and-validation #22](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/22) — fix(core): repair broken int64 decimal encoder without floating-point conversion | Validate int64 decimal encoding at MIN/MAX and randomized round trips. |
| 39 | P0 | [oreslang-platform-conformance #106](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/106) — [ai-dev-loop] Authenticate GitHub webhooks and pin durable workflow event admission | Verify GitHub webhook signatures and replay-resistant durable event admission. |
| 40 | P0 | [oreslang-source.java #1389](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1389) — [ai-dev-loop] Introduce durable actor activation and quiescence control seam | Test actor activation/quiescence seam during overlapping lease takeover. |
| 41 | P1 | [oreslang-serialization-and-validation #16](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/pull/16) — feat(zorde): pilot independent TypeSpec + JSON Schema admission and WIT interface | Prove independent TypeSpec/JSON Schema parity and WIT contract under pinned tools. |
| 42 | P0 | [oreslang-source.java #1353](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1353) — Integrate borrow hardening with NIO HTTP and independent actor mailboxes | Stress borrow-safe NIO HTTP, independent mailboxes, and actor ownership. |
| 43 | P1 | [oreslang-source.net #94](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/94) — harden(tuple): .NET structural tuple v2 admission boundary | Run structural tuple v2 negative/positive admission and ABI parity in .NET. |
| 44 | P1 | [oreslang-source.forge #88](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/88) — harden(tuple): Forge structural tuple v2 admission boundary | Run Forge structural tuple v2 compiler and ownership admission tests. |
| 45 | P1 | [oreslang-source.wasm #97](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/97) — harden(tuple): Wasm structural tuple v2 source admission | Run Wasm tuple v2 source admission and MessagePack boundary parity. |
| 46 | P0 | [oreslang-source.llvm #641](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/641) — Add AOT module, class-method and typed bool support with borrow contracts | Execute AOT module/class/bool source conformance and borrow contract gates. |
| 47 | P0 | [oreslang-source.java #1380](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1380) — Harden receiver loans, reborrow provenance and primitive copies | Prove receiver loan, reborrow provenance and primitive-copy alias safety. |
| 48 | P1 | [oreslang-data-science #14](https://github.com/ores-truffle-oreslang/oreslang-data-science/pull/14) — fix(matrix): overflow-safe shape validation in real Oreslang source (#9) | Run true guest matrix-shape overflow and storage bounds tests. |
| 49 | P0 | [oreslang-source.java #1357](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1357) — security(draft): deny process-wide GC from actor code on current main | Execute guest attempts at process-wide GC incl. helper/reflection routes. |
| 50 | P0 | [oreslang-source.java #1348](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1348) — draft(graal): integrate audited untrusted host cache and close-fence primitives on main | Run untrusted host cache NFC, deadline/teardown and isolate separation regressions. |

## Execution evidence recorded in this session

- Zorde PR #25: located same-line false-positive compiler-privacy diagnostic bypass; source-free regression model reproduced six forgeries, new local 29-case test suite passes, code/tests committed to the existing PR branch. Still requires real compiler diagnostics and trusted CI.
- All 50: located as open via live search, each assigned a concrete next execution gate. Status of executable CI was not independently checked for all 50.
- No private source was exported or copied to a different org, no PR merged, and no branch protection changed.

## Dependency slices

- Task: conformance #105 → Java parser #1377 → Java runtime #1379 → handle #1407 → cancellation #1402 → LLVM reject #640 until native support.
- Hot reload: common protocol #89 → Java publication #1270 → mailbox watermark #1367 → Java activation #1389.
- Freestanding: LLVM static kernel #629 → source ABI #653 → no-libc QEMU #580, all require executable evidence.
- Private CI: conformance authorization #57/#109 → Java source tree proof #1361 → immutable bundle #1373; none authorizes unreviewed cross-org source transfer.
- Named calls: Java #1335 → #1400 → #1408 → invocation ABI #1397.

## Source-free snapshot integrity tests

The structured inventory can be validated with `python3 scripts/validate-recovered-work-items.py`, and the schema regression tests with `python3 tests/test-recovered-work-items.py`. Nine local synthetic-fixture tests passed, exercising counts, identities, URL origin, duplicate rejection, status claims and source window. The actual 50-entry JSON also passed an independent in-session structural/identity check. These checks **do not** query GitHub live, prove compiler execution, or establish that any tracked feature is complete.

## How to update

Change an item's `observed` status only after exact-head checks and evidence URL are captured; record the relevant commit, runner/job steps, and independent security approval where applicable. The accompanying JSON is a structured snapshot.

## Execution wave 1 follow-up (same day; no release certification)

- **Task #17, Java #1407:** corrected callback registration inside
  `TaskScope.startTask()` so terminal notification occurs outside
  `admissionLock`, preserving the atomically reserved child join slot.
  Added a deterministic inline-scheduler regression that inspects whether a
  scope completion callback holds the admission monitor. Changes committed
  to its stacked draft branch; real Maven/JUnit execution is still unverified.
- **Task #2, Zorde #25:** reconciled this Markdown gate with the JSON ledger:
  **29** source-free diagnostic verifier regressions, not an executed native
  compiler negative/positive suite. Keep the draft and parent #20 gated.
- **Recovery inventory #110:** added a Markdown-versus-JSON parity verifier
  and six source-free regression cases. These checks reject priority, action,
  PR URL, summary, and row-count drift. This is metadata integrity, not CI.
- **Current CI observations:** conformance harness run
  [39176331456](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/39176331456),
  job 117819659188, and Java fast-ci run
  [39176109871](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39176109871),
  job 117818999011, each failed with zero executable steps.
  A real test verdict requires an approved source-local runner.
- **Private-source boundary unchanged:** investigations #22/#77, publisher
  approval, branch protection and CODEOWNER review are prerequisites to any
  external carrier export. No cross-org source transfer authorized.


## Source-free alternate Actions capacity verification

Private carrier `opto-sync-test/go-java-validation` (repo ID
1323598177) hosted an **independently written**, source-free Java 21
concurrency/runner canary on branch
`audit/sourcefree-taskscope-canary-20261018`. At commit
`c06c67734bd1f5b9f29b4a5cb872b99828e632a5`, Actions run
https://github.com/opto-sync-test/go-java-validation/actions/runs/39177621239
completed successfully with **eight executed steps**, including compile
and 1,750 synthetic concurrency cases; follow-up
[run #39178027624](https://github.com/opto-sync-test/go-java-validation/actions/runs/39178027624)
also passed eight steps and **2,250** source-free cases (including
integer-saturation checks). A separate local Java 21 source-free
model passed **3,500** cases.

The alternate org is **runner-capable**; this is explicitly **not** a
release test of #1407 or a cross-org private Oreslang tree mirror.
No private Oreslang source, Git blobs, credentials, or provenance code
was transferred. The source repository's reviewed destination allowlist
has no approved entries, and open security issues
[Java #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962),
[Java #1368](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1368)
and [conformance #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
block any private-source transfer. An available budget cannot override
these conditions. Exact-source Maven/JUnit/GraalVM CI remains pending.
