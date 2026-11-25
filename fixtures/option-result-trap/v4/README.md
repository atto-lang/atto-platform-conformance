# Caller-side trap, Option and Result — three-backend acceptance v4

**Historical Option-valued proposal. Use the current [Result trap fixtures](../v5/README.md).**

Run the exact same `three-backend-boundary.atto` source (Git blob
`51b9c735af6b841921469698dd0da7aff37d2b79`) through the Java/Graal,
LLVM native AOT, and .NET NativeAOT compilers. A passing guest must return
signed `int 7` after independently observing both `Some(Ok(5))` and
`Some(Err("id must be nonnegative"))`. Errors represented by `Err`
remain data, never caught exceptions. No automatic flattening or implicit
`Option<Result<T,E>>` to `Result<T,E>` conversion is allowed.

The core fixture deliberately uses **no classes, actors, host I/O, imports, or
throw**, so portable scalar ADT and caller-trap lowering can be proved before
general exception and actor runtime work. A separate Java-only checked-cast
guest in Java PR #3059 exercises ordinary error capture as `None`; it is not
a cross-backend equivalent source and cannot establish the LLVM/.NET unwind ABI.

## Required independent proofs

- **Java/Graal:** compile, typecheck and execute the real `.atto` guest;
  require result `7`, semantic type rejection, and ordinary checked-cast
  failure as `None`. Source candidate: Java PR #3059.
- **LLVM native AOT:** lower nested tagged sums with correct ownership and
  valid LLVM IR, compile and execute the identical guest at Clang O0/O2;
  check error discriminants and no implicit flattening. LLVM PR #1774 now
  contains a **candidate** restricted `trap (40 + 2)` -> `Some(42)` compiler
  lowering for pure integer expressions, with an actual AOT/Clang O0/O2
  process-exit-42 CTest, plus explicit rejection of complex operands.
  This positive test has not yet produced exact-head stepful runner evidence.
  It does **not** implement `Option<Result<...>>` or ordinary throw-to-None.
  A successful rejection is **not** a positive nested-Result parity pass.
- **.NET NativeAOT:** verify independent nested tag/payload SSA and CIL,
  NativeAOT publish and execute the guest on Linux x64 and Windows x64;
  preserve Result.Err data and an outer Option tag. First deliverable
  .NET PR #508 now includes a candidate **non-throwing, synchronous `trap int`**
  slice lowered to existing `Some(int)` tagged SSA/CIL, plus real
  negative admission of unsupported `Result` and nested trap values.
  The new limited code and NativeAOT execution are still unverified at
  exact head; ordinary throw-to-None and `Option<Result>` are not implemented.
  A rejection is **not** parity.

After scalar success, add a separate identical-source ordinary guest Error
fixture and require `None` only for an ordinary throw. Panic, raise,
forced cancellation, host traps and fatal engine errors must bypass `trap`.
Each backend must demonstrate once-only operand evaluation, exact cleanup,
ownership safety, and fail-closed suspension until continuation effects are
proven. Do not use C++ catch-all, CLR catch-all, a Result-to-Option cast,
sentinel payloads, host interpreter output or exception-message matching as
substitutes for proper compiler lowering.

## Evidence policy

Exact source commit, root Git tree, and compiler binary digest must be pinned.
Require nonzero **executed** compiler/build/test steps and actual native
binary execution. Native and guest failures must be distinguished. A zero-step
failed Actions workflow, source-text matcher, host-only assertion, negative
source admission, or schema validator alone **does not certify parity**.
When using private token-free alternate-org CI, only a complete identical
Git tree and per-file blob verification qualifies as an exact-source mirror;
never make partial copied files appear to be a full compiler run.

Run `node bin/verify-trap-option-result-v4.mjs` from this repository to check
the fixture's Git-blob integrity; this is intentionally **not** a backend test.
