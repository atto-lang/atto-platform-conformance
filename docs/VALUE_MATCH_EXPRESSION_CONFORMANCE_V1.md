# Value-producing match: exact-source conformance inventory v1

This suite distinguishes expression `match` from procedural `do match`.

* `return match value over ...` returns the selected arm's value to the
  match expression; it never turns into an implicit actor response.
* `do match value over ...` dispatches procedures. An arm-level `return`
  exits its enclosing callable, rather than manufacturing a match result.
* The Java/GraalVM implementation integrated through PR #931 accepts exactly one
  `return expression;` in each value-match arm. Multi-statement value arms
  are deliberately outside this v1 implementation.
* Existing legacy statement matches are accepted for compatibility until
  the value-expression migration can be performed without regressions.

Each fixture has a pinned Git blob SHA-1 recorded in `manifest.json`.
The Node tests prove inventory and source integrity **only**. They do not
execute Oreslang. Although the Java implementation passed prior focused and full Maven
tests with related source programs, no Java/GraalVM, LLVM, Wasm, or browser
backend is marked confirmed until its compiler and runtime execute these
exact fixture bytes and report positive and negative verdicts.

The nominal `Message.Compute` enum payload and compiled actor
`self.respond()` ABI are separate future compiler/runtime milestones.
