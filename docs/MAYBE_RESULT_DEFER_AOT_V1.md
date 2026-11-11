# AttoLang `maybe`, fallible `?=`, and lexical `defer` — AOT admission contract v1

**Status: SPECIFICATION + SOURCE-FREE REFERENCE MODEL ONLY (2026-11-10).**
No Java/GraalVM, LLVM, .NET NativeAOT, Wasm or Forge guest compiler acceptance or execution is claimed. All five compiler-backed lanes are **NOT_EXECUTED** until their own exact-head guest runs, typechecker failures and native artifacts are supplied. The source candidates below are not accepted compiler fixtures yet.

## Syntax and return authority

```atto
define pub fnc balance(int id) -> Result[float, Error] as
  defer log("balance() completed");
  return maybe
    Ok(user) ?= fetch_user(id);
    Ok(account) ?= fetch_account(user);
    Ok(balance) ?= get_balance(account);
    return Ok(balance)
  else
    Err(reason) -> {
      log_error(reason);
      return Err(reason)
    };
  end;
end
```

Normative forms:

- `do maybe ... else ... end`: a procedural scope; any ordinary fallthrough does **not** return a function value. A non-`void` function still needs a definite explicit `return` on every reachable path.
- `return maybe ... else ... end;`: an expression operand of an explicit outer `return`. Its normal arms may produce a typed value; its arms may instead contain **true function-return statements**. If all arms return from the enclosing function, the `maybe` expression has uninhabited `Never` / bottom completion and the outer return is unreachable. This is legal: do not emit a duplicate return and do not reject it as redundant.
- `return` in a `maybe` body/handler always exits the **nearest enclosing callable**, never an arm or `maybe` itself. A nested lambda's return exits that lambda, never the parent. This intentionally differs from the existing Java value-`match` arm-lowering convention in which terminal source `return` can be normalized into an ARM_RESULT. **Never reuse that lowering unchanged for `maybe`.**
- `maybe` is a **contextual keyword**, not globally reserved. A local named `maybe` and `return maybe;` stay legal. The parser must distinguish block syntax using context and a verifiable block boundary; ambiguity rejects without guessing.
- `?=` is one atomic operator (no whitespace separating `?` and `=`); do not parse it as the existing conditional `?` followed by assignment. A standalone `?=` outside a fallible scope is rejected in v1.
- `else` is mandatory in v1 unless a later separately approved propagation rule proves a matching enclosing `Result` or `Option` return type. An omitted `else` must not silently auto-propagate on today's compilers.

## Typed failure and evaluation contract

Each `P ?= expr;` evaluates `expr` **exactly once**, then matches the success constructor/typed pattern `P`. If it matches, its bound payload is introduced in the successful continuation only, respecting borrow, move and shadowing rules. If not, the remainder of the `maybe` body is skipped immediately. An explicit failure alternative (e.g. `Err(reason)`, `None`) is dispatched to `else`. Unmatched failure is a compile-time exhaustiveness error, never a fabricated runtime exception or hidden implicit return.

- `Ok(x) ?= Result[T, E]` continues with `x: T`; the failure path carries `Err(E)`.
- `Some(x) ?= Option[T]` continues with `x: T`; the failure path carries `None`.
- The compiler constructs a finite, static union of possible failure alternatives for all bindings and proves every alternative covered by `else`. Different `E` types are **not** silently converted to a common `Error`; an explicit declared sum/widening conversion is required.
- Constructors, nested patterns, `None`, and nominal error matches must retain their exact identity. `Err(_)` never catches `None`; `Some` never catches `Err`.
- `else` executes exactly once for the first failed binding, **not** for a successful `maybe` body and not for an arbitrary thrown exception.
- Failure is a **value**, not `throw`, `raise`, `panic`, host exception, actor CONTROL message, cancellation or stack/resource exhaustion. `maybe` must not intercept those other effects.
- No captured binding, moved value, borrowed payload or error capability may escape an actor boundary or a lifetime. Suspend only when separately effect-checked; all cancellation and actor shutdown must obey the existing physical-quiescence policy.

## Cleanup and explicit returns

- `defer expr;` registers lexical cleanup on execution reaching the declaration. Each registered cleanup runs at most once and, on ordinary structured exit, exactly once, in last-in-first-out order. A function-scope defer runs after the handler and after the return operand is evaluated.
- A defer inside the `maybe` body runs when that body exits, **before** the handler executes if a `?=` fails. A defer inside an `else` handler runs when that handler exits.
- The pending returned value is evaluated before defers run. Preserve existing source `ReturnCleanupChecker` constraints: a cleanup cannot reassign the already returned local; controlled mutation of a returned mutable object remains separately checked.
- Ordinary `defer` is currently an **expression** in the Java parser. Multi-statement cleanup uses an existing closure expression (`defer || -> { ... };`) where supported; `defer { ... };` is **not** admitted in v1 without explicit parser/runtime work.
- An ordinary `defer` may not introduce an untracked suspension or bypass the cancellation/cleanup effect lattice. No user `return` inside cleanup may override a pending function return. Cleanup exceptions must preserve the existing failure-priority/suppressed-diagnostic policy.
- Cancellation should run eligible cleanup only when controlled unwinding is possible. A hard process exit or forced termination cannot promise that defers execute.

## Compiler lowerings and acceptance

Parse to dedicated `MaybeStmt`/`MaybeExpr` plus `FallibleBind` AST nodes; do not substitute untyped `try/catch` or existing value-match ARM_RESULT. Typecheck successful places and error algebra, prove exhaustiveness and dominance, and build a typed CFG with:

1. Left-to-right eval-once block per operation.
2. Constructor-tag test; success-edge payload binding; failure-edge transfer to a single typed dispatch.
3. `Never`-aware return and definite-exit analysis (including `return maybe` containing nested returns).
4. Scope-specific cleanup pads for success, failed match, explicit return, throw/cancellation, with single-visit LIFO semantics.
5. Borrow/drop/lifetime proofs on **each** CFG edge and strict separation of the actor's cancellation/CONTROL effects.
6. Direct AOT lowering using static tags and control flow; no reflection, runtime code generation, dynamic exception dispatch, or hidden GC requirement.

Existing Java value-`match` tests and cleanup analysis are **not** evidence for this new syntax. Run real positive and negative `.atto` guests at identical fixture blobs for Java/GraalVM, LLVM O0/O2, .NET NativeAOT, Wasm and Forge/Cranelift, with actual nonzero executed steps. For any private cross-org test mirror, require source authorization, approved destination, exact tree/blob identity and independent review; never treat a zero-step run as execution.

## Mandatory regression matrix

- Both `do maybe` and `return maybe` variants, including `return maybe` with nested explicit `return`, expression-valued branches, and mixed valued/diverging branches.
- Every failure position (first, middle, last) and success: one evaluation per binding, no evaluation after failure, first error retained.
- `Err` and `None`, nested constructors, missing/incompatible `else`, mutually incompatible error types, wrong payload arity, malformed `?=`.
- `defer` before and inside the scope, double cleanups, LIFO order, returned-value stability, cleanup throw/cancel precedence.
- Valid `maybe` identifier in unrelated expressions; wrong/missing `end`; `?=` used outside `maybe`; no accidental ternary/operator capture.
- Borrow-after-move, escape from a handler, return of loaned payload, suspend-with-exclusive-borrow and actor trust/cancellation isolation.
- LLVM O0/O2 and .NET NativeAOT native execution, plus source-level negative rejection on all five backends.

Companion machine-readable cases: `contracts/maybe-result-defer-v1.json`. A Node reference-model test is **source-free only**, not evidence of AttoLang compiler acceptance.
