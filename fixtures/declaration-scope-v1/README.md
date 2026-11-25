# Canonical declaration scope v1 — cross-backend corpus

These `.atto` files are a **source corpus**, not a compiler or guest-runtime
receipt. Positive variants are intended to yield the same public AST/API and
formatter output (apart from existing unrelated formatting conventions).

Rules:
- `define pub` is canonical at file root; compilers also accept `pub define`.
- Module/class/actor members canonically omit `define`; compatibility accepts
  it in both visibility orders.
- Duplicate visibility and nested classes inside classes reject.
- Public signatures, ownership metadata and eventual packaged binary symbols
  must be identical before and after formatting.
- The source-free fixture set does not establish Java, LLVM, .NET NativeAOT,
  Wasm, Forge, JS or Rust parity; every backend must execute exact-head compiler
  parse/typecheck and positive/negative guest cases.

For each backend, record compiler SHA/tree, fixture blob, non-zero job steps,
compiler invocation/exit code, stdout/stderr, link outcome and guest output.
Mark zero-step or host-only evidence **NOT_EXECUTED**. Do not export private
source to another organization without independent authorization.

## Adversarial hardening additions

- `root-end-delimited.atto`: ensures `define pub fnc` does not create a
  second, phantom type frame when the body closes with `end`.
- `negative-local-define.atto`: a callable body cannot create a new
  nested declaration by inserting `define`.
- `negative-new-without-newable.atto`: a user-defined static method
  named `new` is not admitted as a class factory merely because it was
  parsed. The language requires an explicit `Newable` trait contract.

The Java reference compiler PR #2794 now contains a compiler-owned,
sealed `Newable[T]` v1 witness with an exact static zero-argument factory,
and a pending Graal guest-execution test. Generic/static trait extension,
portable binary-package ABI validation, and backend-specific native lowering
remain unfinished. Do not treat this source corpus or a parser-only
acceptance result as proof of factory execution.

## Backend source audit (not executable parity)

An inspection of the compiler source surfaces the following scoped claims,
**not** compiler runs:

| Frontend | Observed source behavior | Current limitation |
|---|---|---|
| Java/GraalVM | PR #2794 normalizes parser acceptance of both root orders and nested compatibility | Type-level Newable static witness and guest execution not yet proven |
| .NET structured source | Scans both `define` and `pub` with duplicate checks | Rejects nominal class/actor methods until AOT lowering is implemented |
| LLVM native source | Accepts both orderings for certain class/type declarations | Public `define pub fnc` is not generally admitted in its native subset |
| Forge scalar frontend | Scans both modifiers and rejects duplicates | Only scalar `fnc` source form currently lowered |
| JS scalar compiler | Parses both root orders and module-local aliases | Does not lower arbitrary class/actor sources |
| Wasm / Rust | No exact executable audit on this change | Do not infer acceptance |

These are **source observations**, not passing evidence. In particular,
the LLVM and .NET restrictions must remain explicit backend differences
until real compiler/guest test receipts prove portability.
