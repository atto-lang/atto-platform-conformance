# AttoLang critical gate — native header exact-blob verification (2026-11-02)

## What actually ran
Local container toolchains: GCC 14.2 and Clang 17, C++17 `-Wall -Wextra -Wpedantic -Werror`, with AddressSanitizer and UndefinedBehaviorSanitizer enabled. No private GitHub Actions minutes or cross-org source export were used for this test.

Exact LLVM PR #1289 source blobs, checked with `git hash-object` and re-fetched from the branch:
- `src/main/cpp/oreslang/runtime/CriticalGate.hpp`: `ecb65f1111a37f1ea0991a9ad03bdced2df6f50f`
- `src/main/cpp/oreslang/runtime/LogicalMutex.hpp`: `f03082fc83ce645dd16c6db7aefa98a1d57be04d`
- `tests/critical_gate_capacity_handoff_test.cpp`: `ebda8035c43774536d8978903552031d8b16a19b`
- `tests/critical_scalar_copyout_compile_test.py`: `0d6df06d5cc631c6c4fa21a27bad0b8c0289eeef`

The checked-in native C++ stress harness tested all 8,192 FIFO waiter slots, bounded-overflow rejection, consistent scalar state after handoff, no phantom retirement receipts, and 1,000 retire-versus-release races. It ran successfully under both GCC and Clang with ASan+UBSan, approximately 20,900 assertions per run (the two valid race outcomes have different assertion counts). No sanitizer findings were reported.

The checked-in Python host compile-negative harness was run under both GCC and Clang: `void` and scalar results admitted, raw reference, pointer, `std::reference_wrapper`, `std::string_view` and unverified aggregate copy-out rejected (7/7 probes per compiler). The new `LogicalMutex<T>::with_owner` return rule is intentionally conservative and remains a **host-only** gate.

## Limits

This is byte-exact **LLVM host runtime** evidence, not native Oreslang guest compilation or execution. The LLVM compiler, Java/Graal interpreter, .NET NativeAOT, Wasm and Cranelift remain unverified for the canonical critical source fixtures. Java runtime scheduler-dispatch test cases also have no current-head execution receipt.

The latest exact LLVM source branch head is `b725eea4b16685c5d44ece7c49189a96f7a4d429`, tree `9f4a4996d8d77597697465e198a2e32d4715fd6d`. Related hosted workflow jobs report zero executed steps, classified `NOT_EXECUTED`. Maintain all draft PR holds pending stepful native guest results and independent security review. The private cross-organization source mirror policy is not authorized for further destinations; refer to Java security issue #962 and governance PR #2457 for independent-approval requirements.
