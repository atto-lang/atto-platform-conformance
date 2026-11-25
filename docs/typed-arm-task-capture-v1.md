# One copied `int` task capture from typed match/switch arms (candidate v1)

**Status:** scoped Rust/Wasm compiled-guest PASS on the exact source head, **not** cross-backend parity. Java Native Image, LLVM native and .NET NativeAOT are `NOT_EXECUTED`.

This is a stacked follow-up to [typed-match/switch conformance #47](https://github.com/atto-lang/atto-platform-conformance/pull/47), [Atto spec #53](https://github.com/atto-lang/atto-spec/pull/53), and [Rust/Wasm compiler #245](https://github.com/atto-lang/atto-source.rs/pull/245) (stacked on #236). The original 12-case registry retains its previously verified v2 capture-free receipt; this new registry is **separate** so an old PASS cannot be mistaken for this feature.

## Semantics and AOT contract

When an arm pattern binds an `int`, a task using that binder snapshots it **by value** at task creation. The new `atto.async.v3` guest import `task_start_i64(i32 index, i64 copy) -> i32 handle` and exported `task_invoke_i64(i32 index, i64 copy) -> i64` use a statically compiled, arity-checked dispatcher; capture-free v2 task guests keep their existing ABI. Task entrypoint indices are compiler-generated, not arbitrary source names. `await` still causes a cooperative JSPI turn.

Bounded restrictions: one lexical arm-local `int` binder, immutable snapshot (not a reference), `Future<int>` result. `string`, nested `Result` payloads, object pointers, loans, multiple captures, and general closure environments are **not** admitted. The compiler must fail closed with a diagnostic and **no guest artifact** for unsupported captures. Capture name shadowing is intentionally rejected in the supported subset. This is not blanket ownership/borrow safety or generic closure support.

## Executed receipt and source identity

The three files under `fixtures/typed-arm-task-capture-v1/` are byte-identical to the three source strings executed by the browser integration test in exact compiler head `05c8aa182d30313cdce0d671d1ded4bd11c22401` (source browser harness blob `7596fb81e52e3026e38065526fc741b7f78a0916`). The fixtures' Git blob SHA-1 identities are checked by `node --test tests/typed-arm-task-capture-v1.test.mjs`. That Node test is metadata-only: it does not execute the compiler or guest.

[Private alternate carrier run #43960853684](https://github.com/anticaptrad/atto-ci/actions/runs/43960853684), job `133627521871`, commit `b5a8d1270a0620868a10b4687176c030dd048098`: **51/51 exact source blobs verified** (a scoped snapshot, not the entire source Git tree); **40/40 Rust regression tests passed**; **12/12 legacy match/switch compiled guest fixture cases passed**; wasm32 Rust compiler and genuine guest Wasm executed in Chromium JSPI. The browser confirmed the captured `Option<int>` match returns 42, captured `Result<int,string>` switch returns 42, each yielding exactly once, and that a string capture is rejected before guest instantiation. A previous runner run failed because of a doubly escaped browser test regular expression; the corrected test is the successful exact-head receipt above.

## Native parity admission queue

For Java/GraalVM Native Image, LLVM native, and .NET NativeAOT: compile these same `.atto` source fixtures into actual AOT guests, run positive results, verify one-shot copied payload and suspension semantics, and demonstrate the negative emits no executable artifact. Require exact compiler/toolchain/source/guest hash records, a real stepful CI run, independent ABI/ownership review and error/cancellation tests. Parser acceptance, host-only tests, scalar fixtures from other branches, or absent CI runners are never PASS. On platforms without browser JSPI, use the equivalent native cooperative task ABI with explicit, validated compatibility rather than pretending the JSPI import exists.
