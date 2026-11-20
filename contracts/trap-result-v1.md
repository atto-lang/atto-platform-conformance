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

## parse_id and all-backend guest target gate

The [source guest registry](trap-result-guest-v1.json) includes exact-source int.parse(text)? and return match Ok/Err examples, malformed input, Option ?, ordinary throw capture, Result-aware trap, and six deterministic negative tests. The int.parse API must return Result<int,Error> or a losslessly upcastable Error subtype, preserving original Error identity. No host-side parsing fallback counts as source guest execution.

The Node integrity test validates only the registry and fixture source files. All 11 named repositories remain NOT_EXECUTED on these new fixtures until independently checked against their exact compiler heads, with real compiled guest runs or no-artifact diagnostic evidence. The Wasm host and Atto/HDL/realtime scaffolds have different implementation roles; inclusion in the manifest is not certification. Existing Rust/Wasm evidence concerns its earlier pinned subset, not this new parse_id example.

### Checked integer parsing expansion (target only)

Eight additional signed-i64 and bounded-input guest fixtures were copied byte-for-byte from Rust/Wasm PR #331 source candidate `f50e3bf0bf62791bcb517d25982729653b0b44a6` and registered at `TARGET_ONLY`: the minimum signed value, positive/negative overflow, leading zeros, empty and non-ASCII input, and 1,024/1,025-byte boundary behavior. The proposed normative contract is [atto-spec PR #124](https://github.com/atto-lang/atto-spec/pull/124). The contract is not yet ratified; these fixtures are not an implementation claim. Existing source-only Node integrity checks only verify presence and expected result categories, **not compiled guest execution**.


### Backend implementation staging (host-only is not guest parity)

The following linked drafts stage **different layers** of the same spec:
[Rust/Wasm guest compiler #331](https://github.com/atto-lang/atto-source.rs/pull/331),
[LLVM native C runtime #63](https://github.com/atto-lang/atto-source.llvm/pull/63),
[Java/Graal host runtime #52](https://github.com/atto-lang/atto-source.java/pull/52),
[.NET CIL host/negative gates #19](https://github.com/atto-lang/atto-source.net/pull/19),
[Forge C++ runtime #41](https://github.com/atto-lang/atto-source.forge/pull/41), and
[Cranelift host/negative gates #47](https://github.com/atto-lang/atto-source.cranelift/pull/47).
Only Rust/Wasm contains candidate source-guest lowering for the new int.parse
feature, and it lacks an exact-new-head compiled guest receipt. The five
other named backends stage host parsing/ABI or fail-closed compiler admission,
not Result/Option/?/trap codegen.

The machine-readable registry records implementation_stage and draft_pr for
each backend while retaining status=NOT_EXECUTED and guest_receipt=null.
A native host test may pass without changing this guest status. No current
release or merge should infer full multi-backend parity from any of these PRs.
