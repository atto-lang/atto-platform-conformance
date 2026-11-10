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
