# Trap-to-Result conformance matrix v1

**Normative contract:** [atto-spec trap-result-v1](https://github.com/atto-lang/atto-spec/blob/main/language/trap-result-v1.md) (draft PR #71).

**State:** normative target matrix. The companion `tests/trap_result_reference.mjs` remains a *host-only reference oracle* and cannot establish guest correctness. **Bounded Rust-native compiler / wasm32 compiler + real Chromium guest execution** is separately proven by exact source/carrier SHAs in `evidence/trap-result-rust-wasm-20261117.json`. This does not claim generic unions, actor semantics or other-backend parity.

| Operand | Normal completion | Returned exceptional value | Caught source throw | Expected static type |
| --- | --- | --- | --- | --- |
| `T` | `Ok(value)` | n/a | `Err(original Error)` | `Result<T,F>` |
| `void` | `Ok(void)` | n/a | `Err(original Error)` | `Result<void,F>` |
| `Option<T>` | `Ok(Some(value))` or `Ok(None)` | n/a | `Err(original Error)` | `Result<Option<T>,F>` |
| `Result<T,E>` | `Ok(value)` | `Err(original E)` | `Err(original F)` | `Result<T,join_error(E,F)>` |
| `Result<Option<T>,E>` | `Ok(Some(value))` or `Ok(None)` | `Err(original E)` | `Err(original F)` | `Result<Option<T>,join_error(E,F)>` |
| `Result<Result<T,E1>,E2>` | Preserve inner Result as success payload | Preserve outer Err | Preserve thrown Err at *outer* layer | `Result<Result<T,E1>,join_error(E2,F)>` |

`F` is the checked ordinary `throws` error type. Error joins must be **lossless**. If `join_error` cannot represent both returned `Err(E)` and thrown `Err(F)`, emit `E_TRAP_ERROR_JOIN` with no compiled artifact. Never silently stringify, drop, wrap as `Option`, or flatten the inner Result.

## P0 cleanup, exception and identity fixture gates

| Scenario | Required observed result |
| --- | --- |
| `Err(error)?` with two registered defers | Preserve **same tagged Err(Error)** handle; run defers **LIFO once** before return |
| `Err(error)?` inside nested `try/finally` with a defer | Run inner finally → outer finally → defer; do not convert Err into throw |
| `Some(value)?` or `Ok(value)?` | Continue normally; enclosing explicit return still performs registered cleanup |
| `None?` in Option-returning function | Return the original None; run only currently registered cleanup |
| `Err(error)?` before a subsequently declared defer | Do **not** run the unregistered defer; do not read an uninitialized payload |
| `?` inside defer/recover/finally handler | **E_UNSUPPORTED / no artifact** until replacing an existing pending outcome has formally defined semantics |
| `catch (Error caught)` from a thrown existing `Error` | Bind original, identical Error handle in handler scope; unequal to a new Error with identical message |
| Catch-bound Error used outside its handler scope | **E_UNBOUND / no artifact** |
| `trap trap (result?)` returns early | Restore each active trap-depth increment; future unrelated recover remains effective |
| A `raise` crosses nested `trap` and `try/finally` | Preserve raised tag/identity; do not produce Err or invoke ordinary catch; all registered exception cleanup and recover still work |

Every backend must prove exact guest traces (stdout, exit, panic, error identity) and **original tagged pointer/handle preservation** rather than matching only Error message text. Never infer multi-backend parity from the Rust/Wasm reference implementation.

## Required eventual executable fixture gates

- Compile real `.atto` guest sources for every table row and test each branch by running the generated guest (Rust native-host compiler, wasm32-host compiler/guest Wasm, Java/Graal Native Image, LLVM native, .NET NativeAOT, Forge and any advertised backend).
- Prove actual Error payload and identity, at most once execution, exact generic return type, nonflattened nested Result, and correct `?` propagation.
- Negative no-artifact tests: no outer `Some`/`None` on `trap`; bad error joins; non-Error throw; mismatched `Ok`/`Err` patterns; `raise`, `panic`, cancellation and host faults cannot be captured.
- Preserve actor supervisor CONTROL escalation for panic; do not create an ordinary error value for fatal host/runtime failures.
- Require exact source commit/tree, compiler target/toolchain, executed guest bytes, exit/stdout/error traces, and explicit **PASSED / FAILED / UNSUPPORTED / NOT_EXECUTED** per backend.
- Do not convert host-oracle PASS into guest conformance PASS. Mark each concrete supported Rust/Wasm guest profile PASSED only with the exact recorded execution receipt; keep generic unions and every unexecuted backend UNSUPPORTED or NOT_EXECUTED.

Legacy candidate `Option<Result<T,E>>` / `Some(Err(...))` output is a known **nonconformant historical result**, not a fixture to bless.
