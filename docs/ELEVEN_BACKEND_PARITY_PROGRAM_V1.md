# Eleven-backend cross-contract Atto parity index (source-only v1)

This is a **tracking and evidence-admission index**, not a claim of feature support, compile success, or guest parity. The sole authority for language semantics is [atto-spec](https://github.com/atto-lang/atto-spec). Profiles/capabilities belong in [atto-target-profiles](https://github.com/atto-lang/atto-target-profiles). This index links to, but does **not** copy or replace, the existing conformance fixture/guest receipts of individual workstream PRs.

## Verified inventory scope

11 active repositories: `atto-source.java`, `atto-source.llvm`, `atto-source.wasm`, `atto-source.net`, `atto-source.forge`, `atto-source.cranelift`, `atto-source.rs`, `atto-source.js`, `atto-source.hdl`, `atto-source.atto`, `atto-source.realtime`. Each has an exact GitHub-observed `main` SHA and immutable GitHub repository ID. Main snapshot identity is **not** a tested PR-head or executable compiler provenance. All 121 backend × workstream cells are initially `not_executed`. A draft implementation PR hyperlink is a **candidate** for integration, not proof it compiles. A checked-in source-only validation workflow proves only ledger structure.

The eleven tracked workstreams are canonical `^/^^` operators, checked signed-i64, `int / int -> float` (no silent truncation), pure `do sync task<void>`/omitted-void, trap-to-Result, functional pipelines, sealed actor state, typed Pointer/ownership, TenantVM security, I/O permissions and project-root imports. Scope extends to `atto-source.hdl`, `atto-source.atto` and `atto-source.realtime`, but **target-profile applicability is undecided**; a hardware-only or bootstrap target must explicitly deny unsupported semantics, never claim actors or runtime isolation without executed capability evidence.

## Existing work is canonical input, not duplicated

- Operators: [atto-spec #143](https://github.com/atto-lang/atto-spec/pull/143). Java [#72](https://github.com/atto-lang/atto-source.java/pull/72) is the current edition-gated candidate over global rewrite [#70](https://github.com/atto-lang/atto-source.java/pull/70); preserve the #70 exactly-once failure regression and require full legacy `.ores` compatibility tests. These drafts need independent reconciliation, not concurrent merging.
- Forge integration: [#105](https://github.com/atto-lang/atto-source.forge/pull/105) consolidates #42/#44/#49/#50/#52/#102; avoid separate overlapping parser merges until exact-head native CI/ASan evidence.
- Checked arithmetic: [conformance #235](https://github.com/atto-lang/atto-platform-conformance/pull/235), [spec #144](https://github.com/atto-lang/atto-spec/pull/144); integer division's floating result type is an accepted owner decision ([atto-spec #151](https://github.com/atto-lang/atto-spec/pull/151)); its IEEE rounding and zero-divisor taxonomy remain unapproved. Java [#66](https://github.com/atto-lang/atto-source.java/pull/66) and .NET [#191](https://github.com/atto-lang/atto-source.net/pull/191) are unexecuted candidate implementations.
- Inline tasks: [conformance #115](https://github.com/atto-lang/atto-platform-conformance/pull/115). Preserve void-only `do sync task`; do not reinterpret it as spawning a task or a general `do sync task<int>`.
- [Trap Result #68](https://github.com/atto-lang/atto-platform-conformance/pull/68), [pipelines #112](https://github.com/atto-lang/atto-platform-conformance/pull/112), [sealed actor state #113](https://github.com/atto-lang/atto-platform-conformance/pull/113) retain their own normative positive/negative fixtures and independently executed receipts where present.

## Non-vacuous release process

1. Resolve the relevant spec and formatter contradictions and independently approve any target-profile exception.
2. Pin every compiler PR **HEAD and full Git root tree**, target/toolchain and the exact positive/negative .atto source bytes.
3. Obtain separately authorized source-local CI or a reviewed **exact source commit/root tree/numeric private carrier ID** export. Never bypass disabled source export allowlists, independent reviewer or protected-main policies merely because another org has Actions minutes.
4. Run compiler and **actual compiled guest** positives plus negatives (no emitted artifact), including ownership, TenantVM and typed error boundary tests as applicable. Record real job ID, run attempt, nonzero executed steps, results and artifact digests. Source-only, host-only and synthetic tests cannot count.
5. Import authenticated execution receipts through a *separately reviewed* trusted verifier. **v1 intentionally rejects every `passed` status**; promoting a cell requires a verified v2 evidence contract, not arbitrary editable JSON.
6. Merge only after exact-head checks, CODEOWNERS/security review, competing PR disposition and the active Ready-cycle governance conditions.

**Status on 2026-11-20:** 121 inventory entries, **0 new compiled-guest passes** established by this index. Branch protection observed disabled on all 11 main branches; administrator must verify rulesets and enforcement rather than assume this index changes policy. Existing external test receipts are not blanket export authorization.

## Core/Option — eleven-backend library parity dashboard (2026-11-22)

The [generated core/option dashboard](CORE_OPTION_PARITY_DASHBOARD_V1.md) and
[machine-readable snapshot](../contracts/eleven-backend-parity-v1/core-option-dashboard.json)
extend this existing draft with all **11** backend repository IDs, immutable observed
main commit SHAs, and exact implementation candidate heads for nine compiler repos.
`atto-source.atto` and `atto-source.realtime` remain explicit "no option candidate
identified" slots, never silently counted as equivalent to another compiler.

The Java/GraalVM candidate [#1767](https://github.com/atto-lang/atto-source.java/pull/1767)
is additionally pinned to its exact Git root tree, both native `.atto` library
blobs, two authored guest fixture blobs, and the JUnit test class blob. Six
JUnit case identities are tracked, including two *actual linked guest* test
implementations; these are **AUTHORED / NOT_EXECUTED**, not passes.

[`core-option-parity-dashboard-v1.mjs`](../lib/core-option-parity-dashboard-v1.mjs)
rejects altered source SHAs, wrong repo/PR identities, missing cases, forged
compiled-guest/JIT/AOT/sanitizer receipts, premature release qualification and
self-reported unsupported capabilities. The independent source-only test suite
also checks that the checked-in dashboard matches the exact registry.
Promotion requires a separate independently authenticated exact-head compiler
and executed guest verifier; a Node source-only pass must never become a
compiled guest status.

## Core/Option borrow and affine ownership parity (2026-11-22)

The [borrow/ownership matrix](../contracts/eleven-backend-parity-v1/core-option-borrow-v1.json)
now registers **16 semantic cases × all 11 compiler profiles = 176
NOT_EXECUTED cells**. The cases cover shared tag queries, the original owner
surviving a scoped loan, affine nested `Option` and `Result` extraction
denials, `unwrap_safe` and fallback escape denials, Copy-safe extraction,
move/escape/suspension boundaries, inactive-variant deterministic drop and
callback invocation counts.

Java implementation draft [#1767](https://github.com/atto-lang/atto-source.java/pull/1767)
now contains `is_some_borrowed/is_none_borrowed` in `core/option.atto`
and `is_ok_borrowed/is_err_borrowed` in `core/result.atto`, all using
explicit scoped `borrow` formals. The linked
`tests/core_option_result/borrowed_queries.atto` guest must output `42`
after borrowing and then reusing the original owner. A separate
`CoreOptionResultBorrowSafetyTest` exercises genuine compiler ownership
analysis and requires targeted rejection of affine extraction from a loan.
These are authored requirements, **not executed compiler or guest results**.

The [borrow parity validator](../lib/core-option-borrow-parity-v1.mjs)
and [mutation tests](../tests/core-option-borrow-parity-v1.test.mjs) compare
exact backend candidate source SHAs to the existing core-option dashboard and
reject any self-authored `passed`, `unsupported`, `host_only`, receipt, or
release claim. A separately authenticated source/guest/AOT verifier is
required before promotion.

**Important CI export blocker:** Java's checked-in
`.github/private-ci-approved-repositories.txt` currently lists no active
approved destinations; the observed source head/root tree is not a reviewed
snapshot for `channelsiege/atto-ci`. The user-requested token-free Git-tree
mirror cannot override that explicit Java repository guard. Do not mirror
the complete private Java compiler into a different organization or interpret
a small source-only contract copy as a compiler run. Source-local full builds
or an independently approved exact-snapshot destination remain the real
execution routes.

## Backend-owned core borrow rollout: 11 tracked compilers (2026-11-22)

[Exact source-only borrow candidate ledger](../contracts/eleven-backend-parity-v1/borrow-source-ledger.json)
records the observed PR-head commit, full root tree SHA, and **36 explicitly
verified Git blob identities** across all eleven backend slots. No private
compiler contents are copied into this conformance repo. The companion
[source-integrity validator](../lib/core-option-borrow-source-ledger-v1.mjs)
and [adversarial regression suite](../tests/core-option-borrow-source-ledger-v1.test.mjs)
cross-check the backend identities against the core-option dashboard and
reject missing/duplicated source artifacts, valid-looking SHA substitution,
fake AOT, fake guest PASS, fake unsupported, or release promotion.

Seven compiler-owned source candidates (Java, LLVM, Rust, .NET, Wasm, Forge,
Cranelift) propose explicit `borrow Option<T>` and `borrow Result<T,E>`
read-only tag queries. Six of them now also have local
`tests/core_option_result/borrowed_read_42.atto` and
`negative_affine_borrow_escape.atto` source fixtures. The expected
semantic negative **must reach the typed ownership checker and produce no
guest artifact**; rejecting unknown syntax, class grammar, imports, or
unimplemented generics does *not* prove the borrow model.

JS keeps its independent concrete `Option<int>`/`Result<int,int>`
compiler; the expanded Node test requires scalar carriers to remain
reusable and prohibits unsupported generic `borrow!`/`take!` or
affine escapes from compiling. HDL remains a distinct proposed RTL
scalar tagging path requiring real synthesis/simulation evidence.
Self-hosted Atto and Realtime are explicit no-candidate slots, not
omitted or implicitly marked unsupported.

**Execution boundary:** metadata SHA comparison and source-only Node
tests are not guest compilation. All **176 borrow conformance cases**,
all native AOT and sanitizer/equivalent checks remain `not_executed`.
Private source export policy denies this snapshot to unapproved carriers.
Do not use an alternate Actions org unless the exact source head/tree,
private carrier identity and independent approval are genuinely admitted.
