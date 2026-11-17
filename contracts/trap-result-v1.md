# Trap-to-Result conformance matrix v1

**Normative contract:** [atto-spec trap-result-v1](https://github.com/atto-lang/atto-spec/blob/main/language/trap-result-v1.md) (draft PR #71).

**State:** target test contract, not compiled guest evidence. The companion `tests/trap_result_reference.mjs` is deliberately a *host-only reference oracle*. It cannot establish parser, borrow checker, guest Wasm, native AOT or cross-backend correctness.

| Operand | Normal completion | Returned exceptional value | Caught source throw | Expected static type |
| --- | --- | --- | --- | --- |
| `T` | `Ok(value)` | n/a | `Err(original Error)` | `Result<T,F>` |
| `void` | `Ok(void)` | n/a | `Err(original Error)` | `Result<void,F>` |
| `Option<T>` | `Ok(Some(value))` or `Ok(None)` | n/a | `Err(original Error)` | `Result<Option<T>,F>` |
| `Result<T,E>` | `Ok(value)` | `Err(original E)` | `Err(original F)` | `Result<T,join_error(E,F)>` |
| `Result<Option<T>,E>` | `Ok(Some(value))` or `Ok(None)` | `Err(original E)` | `Err(original F)` | `Result<Option<T>,join_error(E,F)>` |
| `Result<Result<T,E1>,E2>` | Preserve inner Result as success payload | Preserve outer Err | Preserve thrown Err at *outer* layer | `Result<Result<T,E1>,join_error(E2,F)>` |

`F` is the checked ordinary `throws` error type. Error joins must be **lossless**. If `join_error` cannot represent both returned `Err(E)` and thrown `Err(F)`, emit `E_TRAP_ERROR_JOIN` with no compiled artifact. Never silently stringify, drop, wrap as `Option`, or flatten the inner Result.

## Required eventual executable fixture gates

- Compile real `.atto` guest sources for every table row and test each branch by running the generated guest (Rust native-host compiler, wasm32-host compiler/guest Wasm, Java/Graal Native Image, LLVM native, .NET NativeAOT, Forge and any advertised backend).
- Prove actual Error payload and identity, at most once execution, exact generic return type, nonflattened nested Result, and correct `?` propagation.
- Negative no-artifact tests: no outer `Some`/`None` on `trap`; bad error joins; non-Error throw; mismatched `Ok`/`Err` patterns; `raise`, `panic`, cancellation and host faults cannot be captured.
- Preserve actor supervisor CONTROL escalation for panic; do not create an ordinary error value for fatal host/runtime failures.
- Require exact source commit/tree, compiler target/toolchain, executed guest bytes, exit/stdout/error traces, and explicit **PASSED / FAILED / UNSUPPORTED / NOT_EXECUTED** per backend.
- Do not convert host-oracle PASS into guest conformance PASS; keep new semantics unsupported until the backend actually implements Result-valued trap.

Legacy candidate `Option<Result<T,E>>` / `Some(Err(...))` output is a known **nonconformant historical result**, not a fixture to bless.
