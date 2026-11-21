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
