# AttoLang durable M0 cross-backend admission and reference contract (v1)

**Status: compiler-metadata candidate + portable source-free reference; NOT compiled guest parity.**
This contract must not be used to claim runtime workflow replay, exactly-once delivery, typed storage, live actor scheduling, or native backend support. Java's activity/workflow compiler M0 is on draft PR #2480 stacked on draft #2474, not on reviewed `main`.

## Byte-identical five-repository fixtures

The same 464-byte `contracts/durable-m0/v1/checkout.atto` source and the same 1,671-byte `contracts/durable-m0/v1/manifest-v1.json` canonical **candidate** are checked into the Java PR branch and the LLVM, .NET, Wasm and platform-conformance hardening branches. The manifest Git blob is `09a4d48259e5250ee72cf52d3498afec037ce3a3` in all five; the independent SHA-256 pin is `aa1eed7637b99d8c270c3cd7a3f15ab83acf0463b00ebaa58f0f52c8dd525784`. The `.atto` file declares `Billing.PaymentProvider` and `Billing.Checkout`; its recorded history is **not** written in source. The candidate manifest's three commands are inserted through compiler AST test construction: activity step, 250-ms timer and wait event. The `status` read-only query does **not** receive a history slot.

Reference invariants: exact UTF-8 bytes; no whitespace normalization or duplicate JSON keys; immutable ordered history slots 0, 1, 2; fully qualified activity target; manifest SHA-256; unique stable command IDs; query outside history; rejected unsupported mutable workflow state, unversioned contracts, missing targets, signature/arity mismatch, nonserializable expressions and unbounded inputs. Portable reference i64 values above 2^53-1 remain **rejected** pending a lossless typed i64 decoder. This is a declared limitation, not Java i64 parity.

## Five-lane promotion matrix

| Lane | Source admission | Manifest proof | Runtime/guest proof |
| --- | --- | --- | --- |
| Java/GraalVM | `activity` / `workflow` AST and semantic gate authored in draft #2480 | New exact-byte golden JUnit compares real compiler-generated manifest with shared candidate, plus independent Surefire SHA/hex verifier; **not yet executed** | Durable execution closed |
| LLVM | Lexer/parser emits `DURABLE_M0_BACKEND_UNSUPPORTED` for both declarations; five direct compiler-negative fixtures plus shared source and comment nontrigger registered through CTest | CMake source-free digest and structural reference check only | **No LLVM durable AST/MIR lowering or replay** |
| .NET NativeAOT | Structured token parser emits same error before CIL; eight declaration negatives, comment nontrigger and shared source test authored | Native .NET test loads exact manifest and independently hashes/reencodes it; **not yet executed** | **No CIL/NativeAOT durable execution** |
| Wasm | Comment/string-aware source bridge refuses both declarations before native compiler staging; ten negative forms, eight nontrigger forms and malformed UTF-8 tests authored | Node source-free exact-byte test authored; LLVM-to-wasm backend manifest emission unproven | **No Wasmtime/Wasm guest durable execution** |
| Platform conformance | Shared corpus frozen at the byte level | Node host-only strict canonical reference validator with 28 mutation scenarios, size, hash and history/query checks; local Node 22 tests pass | **Reference only, not a backend** |

## Required tests before promoting any backend

1. **Exact-head source execution**, nonzero job steps and unambiguous executed results. `steps=null`, `steps=[]`, skipped or authored-only tests are `NOT_EXECUTED`.
2. Java must first compile the 36 focused JUnit cases and emit the same manifest digest from the *actual* compiler AST. Run full Maven verification separately. Any candidate-golden mismatch is a failing test, never silently regenerated.
3. LLVM must execute the native CTest negative/positive admission cases with no partial LLVM IR or executable artifact, then implement genuine typed M0 AST + IR metadata emission. A CMake hash check alone is not LLVM emission.
4. .NET must execute the real compiler self-tests, then prove typed CIL/NativeAOT compilation and execution separately. A JSON parse/reencode check is not CIL codegen.
5. Wasm must run Node source-bridge tests and actual compiler-backed wasm32 creation, validate the module, then run a real guest in Wasmtime/host separately. A bridged source check is not Wasm execution.
6. Only after source-level recorded commands and runtime state/replay ABI are implemented: persist histories, fence generations, prove idempotency under crash/retry, cancellation/backpressure, timer-event races, supervisor restart/replay, and independently compare canonical outputs across all backends.

**Private-source CI rule:** Use the protected-origin V3 publisher and independent review before any cross-org source-bearing transfer. The current Java source `main` and candidate `scintilla-run` carrier `main` have reported `protected=false`; the V3 allowlist/approval remains unsatisfied. Do not bypass it with connector blob/tree writes or publish private code in a source-free carrier.
