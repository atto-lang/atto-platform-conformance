# Mandatory lambda pipes — parser-target conformance v1

The canonical lambda grammar requires both parameter pipes: `|...| -> body`,
including in `const fnc` expressions. Bare `_ : int -> 5` and `_ -> 5`
are prohibited. `|_|` means one ignored parameter; `||` means zero.

The manifest embeds exact source fixtures to allow future backend parser runners
to submit each source independently, checking acceptance/rejection *before*
typing and code generation. Do not consider a rejection satisfactory merely
because `const fnc` declarations are unsupported; the `val` fixtures test the
same syntax independent of the `const fnc` feature.

All backend evidence is `NOT_EXECUTED`. The accompanying Node test verifies
registry integrity, not actual parsing, compilation, execution, or parity.

Run the host-only check:

```sh
node --test tests/lambda_mandatory_pipes_v1.test.mjs
```

## Executable parity target — separate from parser admission

[`execution-matrix.json`](execution-matrix.json) adds **six positive** and
**six negative** exact-source programs for all eleven Atto compiler/runtime
targets: Java, LLVM, Rust, WASM, .NET, Forge, JS, Cranelift, Atto bootstrap,
HDL and realtime. It records no invented backend outcomes.

The positive profiles distinguish `||` from `|_|`, require checked scalar
direct calls, include both `|int x|` and `|x: int|`, and distinguish a
**local** `const fnc` with call-site input inference from a **module-level**
`const fnc` whose signature requires an explicit input type. The negative
profiles require compiler rejection and no published artifact for missing
pipes, arity mismatch, untyped module ABI and illegal runtime capture.
Unsupported backend subsets must report `UNSUPPORTED`, not claim to execute
the program via a host-side imitation or silent fallback.

A runner may upgrade `NOT_EXECUTED` to `PASS` only with source+compiler SHA
provenance, actual executed guest steps, exit code and stdout, and artifact
hashes. A structured `UNSUPPORTED` report is honest but **not parity**.

The host-only structural check is:

```sh
node --test tests/lambda_mandatory_pipes_v1.test.mjs \
  tests/lambda_pipe_execution_matrix_v1.test.mjs
```

These Node tests validate **registry metadata only**, not any compiler guest.
