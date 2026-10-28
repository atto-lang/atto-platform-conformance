# Semantic reconciliation v1 — negative-first executable target inventory

**Status: TARGET_ONLY_NOT_IMPLEMENTATION_EVIDENCE.** This is a deliberately separate **semantic** fixture set, not an additional scheduler, reactor, Future implementation or state machine. It complements common-source `docs/CONFORMANCE.md`, platform-conformance #194 (scheduler model), common-source #169 (OresVM execution), platform-conformance #192 (adapter protocol), and Java #2193 (strict source-language proposal).

The machine-readable contract is `semantic-reconciliation-cases.v1.json`. Every compiler case embeds a complete `.ores` compilation unit with one expected admission outcome and an invariant. The opt-in runner materializes the exact source in a private temporary regular file, calls a pinned compiler **without a shell**, and requires an exact proposed semantic diagnostic code for rejection. All negative cases **cannot pass on arbitrary parser rejection or unrelated error**. Proposed diagnostic codes are target ABI labels requiring backend agreement, not a claim any current compiler emits them.

Run a real configured target, *only when an authorized compiler binary exists*:

```sh
node bin/semantic-reconciliation-gate.mjs --backend=java --argv='["/absolute/path/to/compiler","--check","{file}"]' --source-sha=0123456789abcdef0123456789abcdef01234567
```

Repeat independently for `llvm`, `net`, `wasm`, and `forge`; a declared source SHA is not cryptographic build attestation. The result is **local source admission only**, not guest execution, AOT, actor interleaving, hard-real-time behavior, source-build provenance, or certified parity. A missing binary returns UNCONFIGURED and a nonzero exit. The runtime trace cases remain PENDING until real guest execution and deterministic scheduler traces are captured with exact source/compiler/tree/job-step evidence. No mocked compiler, source-free oracle, or zero-step workflow may promote them.

**Ownership of normative changes:** language/backend reviewers must reconcile the common-source contract index, Java #2193, Java #1101/#1287/#2048, optional parameter #1335, actor and NIO state-loan rules, and strict I/O. This PR does not override those still-open documents or change runtime code.

**Security:** no private compiler source is transferred to any other organization. Existing approved source policies and protected-main admission remain required before any cross-org testing.

## rt ownership target set: 5 paired operators / 10 compiler cases

Added source-admission cases for `rt copy`, `rt share`, `rt take`, `rt borrow`, and `rt mut borrow`, each with a positive and a negative control. This is **not** a claim of JVM, LLVM, CLR or WASM guest parity. All candidate backends remain `PENDING_GUEST_PROOF`.

The proposed target `E_PARTIAL_MOVE` specifically prevents `rt take owned.field` from duplicating ownership where the current compiler has no field-slot partial-move ledger; it corresponds to [Java #2197](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2197). Negative diagnostics are proposed cross-backend semantic identities, not already-implemented error-code ABIs. Reviewers must reconcile them with existing human-readable backend diagnostics before certification, without replacing a real compiler error with arbitrary parser rejection.

The broader pointerless syntax migration remains in [Java #1841](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1841). Do not duplicate that migration in this fixture-only PR.

## Bounded Future.map admission gate

Use `--suite=future-map` to execute exactly the
`future-map-preserves-nested-return` positive and
`future-map-rejects-implicit-adoption` negative. Omit the flag to run all
26 compiler vectors. Unknown suites fail closed.

```sh
node bin/semantic-reconciliation-gate.mjs --backend=java --suite=future-map \
  --argv='["/absolute/path/to/compiler","--check","{file}"]' \
  --source-sha=0123456789abcdef0123456789abcdef01234567
```

Only an actual pinned compiler may establish admission. A selected pair returns
`SELECTED_SOURCE_ADMISSION_MATCHED_UNATTESTED` and
`fullInventoryMatched=false`: this is neither full-inventory proof nor guest
runtime, AOT, cancellation, or cross-backend parity. The source SHA is
caller-declared, not build-attested, and `E_WRAPPER_LAYER` is a proposed
diagnostic that still needs compiler reconciliation. Forge is a fifth pending
target, not an implemented compiler gate. Keep private source inside approved
security boundaries; do not substitute mocks or zero-step CI for execution.

## Reachable guest extraction paths (not yet executed)

The positive `future-map-preserves-nested-return` fixture uses an explicitly
`suspends` main that awaits the outer mapped Future and then the inner Future,
writing `40`. The `nested-future-two-awaits` main calls its suspending
`use()` path rather than returning a dummy constant. This ensures later guest
execution can observe the intended extraction semantics, but this runner
remains compiler-admission only: it does **not** assert stdout, exit or actor
lifecycle, and no backend may be marked verified from source inspection.

### Inventory drift guard (October 28)

The exact source-free manifest currently has 26 compiler vectors plus 2 pending
runtime traces. The bounded-suite unit test checks both the manifest-wide
length and equivalence between `--suite=all` and the validated manifest, so
adding future vectors cannot leave a stale hard-coded subset count undetected.
This is a repository source/test assertion only; no project Node CI or Oreslang
guest execution is claimed until an actual job has non-empty executed steps.
