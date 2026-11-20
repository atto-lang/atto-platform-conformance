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
