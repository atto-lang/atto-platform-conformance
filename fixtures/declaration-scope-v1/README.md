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

The reference compiler now has a name-based Newable opt-in negative gate,
but static trait satisfaction, nominal trait identity, specialization and
binary-package ABI validation are separate unfinished work. Do not treat
this source corpus or a parser-only acceptance result as factory execution.
