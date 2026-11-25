# Cranelift / Java modern linked-module v1 — executable target fixtures

This is a **source-only, Git-blob-pinned conformance target**, not an assertion
that Java, Cranelift, or any other Atto compiler has passed these cases.
The primary implementation tracker is [atto-source.cranelift issue #71](https://github.com/atto-lang/atto-source.cranelift/issues/71).

## Why a separate corpus?

The historical `fixtures/import-v1` programs contain `+/src/...`, which is
retired by the newer modern-package-root rule. Their immutable Git source
blobs must remain intact as historical profile evidence. These new `.atto`
sources use **`+src/lib/helpers.atto`**, relative `./lib/helpers.atto`,
and the static named export selection from the proposed Atto import contract.

Three *positive targets* require a true verified multi-file source graph,
a public linked scalar callable, guest stdout `42\n`, and successful native
codegen and JIT execution. The nonlinear call `twice(21)` deliberately uses
its formal twice: Cranelift PR #58's trusted pure-function inliner rejects
nonlinear bindings, so a successful backend needs a sound exact-once argument
strategy (proper native call ABI or an explicitly validated equivalent).

Five *compile-negative targets* reject non-public export, retired `+/` root,
root traversal, missing export and duplicate local import binding. None may
emit CLIF, a guest value or an executable artifact. Do not use host-only
parsing or regex acceptance as compiled-guest evidence.

## Evidence protocol

Every registry case is `NOT_EXECUTED`; the Cranelift mainline status is
`NOT_EXECUTED_UNSUPPORTED_ON_MAIN`. The Node test checks immutable
Git-blob hashes, corpus inventory and evidence state only. It does **not**
compile guest code.

For a future backend PASS, attach: source head and root Git-tree SHA,
compiler and runtime toolchain details, actual `check` / `ir` / `run`
invocations, nonzero executed runner job steps, guest byte-exact output,
checked negative diagnostics and no generated IR/artifacts on rejection.
Cross-file imports must be resolved with explicit package authority, pinned
public exports and no implicit ambient filesystem search or symlink escape.
An in-process Cranelift native JIT remains trusted-only and is never an
untrusted TenantVM sandbox.

Do not rewrite the old import-v1 corpus or claim execution from a successful
fixture-integrity test. New implementation work belongs in
`atto-lang/atto-source.cranelift`, and portable normative semantics in
`atto-lang/atto-spec`.

## Shared standalone function-call and checked-effect corpus (source-only)

Nine additional `.atto` sources intentionally require **no imports**:
three successful helper-call programs return 42 (including both `int value`
and `value: int`, and nested calls), three runtime **PANIC** cases preserve
checked i64 overflow in a called function, an eager but discarded argument
and an unused eagerly initialized `val`, and three compilation rejections
cover unbound callee, wrong arity and an omitted formal parameter type.

For native Cranelift `run`, the expected positive CLI output is `42\\n`.
For the browser Rust/Wasm guest ABI, the expected result value is `42`
with *no stdout* unless the source explicitly prints. Backends must not
conflate a host CLI printing the returned value with a guest `stdio.println`.

The cross-backend registry keeps `NOT_EXECUTED` for every target until
separate immutable source/tree-pinned compiler **and guest-execution**
receipts exist. A source-Git-blob validation only establishes fixture
integrity, never guest semantics.

### Root-selector language-spec discrepancy requiring disposition

This corpus's `+src/lib/helpers.atto` and rejected `+/src/...` forms
are **source-file imports in the narrow Cranelift candidate profile**.
The proposed [unified import specification](https://github.com/atto-lang/atto-spec/blob/main/language/unified-static-imports-v1.md)
separately allows a `+/...` package selector after `from pkg`.
Do not apply the source-file rejection to package imports, or advertise
Cranelift's restricted source resolver as full normative package parity.
The compiler and formatter must agree on the distinct selector grammar
before any cross-backend package-import certification.

## Optional real Cranelift CLI execution adapter

This corpus includes `bin/run-cranelift-modern-linked-module-v1.mjs` to
exercise **all 17** exact Git-blob-pinned fixture cases against a caller-
supplied *actual* Cranelift compiler binary. It invokes `check`, `ir`,
and `run` on each source, requires native CLIF `call` instructions
for positives and runtime overflow, and rejects unwanted IR/artifacts
or stdout on negative cases.

```sh
ATTO_CRANELIFT_BIN=/absolute/path/to/orescranelift \
  node bin/run-cranelift-modern-linked-module-v1.mjs
```

A missing/nonabsolute binary exits with status **125** and classification
`NOT_EXECUTED`; it does not skip green. An executed local binary
success reports `LOCAL_GUEST_CANDIDATE_UNATTESTED`, **not** a compiler
release or backend parity PASS, because a supplied binary SHA-256 alone
cannot prove which immutable compiler HEAD/tree produced it. External
evidence admission still requires authorized CI, verified compiler source
head, toolchain, source-tree and actual nonzero executed steps.

Only a reviewed native Cranelift binary may be used; no compiler source
checkout, secret, external runner, cross-repo token or JIT sandbox
assumption is introduced by this optional adapter.

The source-only Node suite also executes adversarial fake-binary probes:
a globally successful shell stub, a globally rejecting stub, and a
symlink masquerading as the compiler. All three must exit nonzero
with `certified:false` and an explicit failure classification.
These prove adapter fail-closed behavior only; no fabricated stub
establishes native JIT compiler coverage.
