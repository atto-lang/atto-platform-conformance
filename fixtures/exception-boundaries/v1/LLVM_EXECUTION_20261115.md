# LLVM merged compiler run

- Source commit `f3cfad24a1d2bf05c13b86981574899d2dfad579`, tree `b0b4cfa3ef5ff8a74d504a3ca8731e56959afe73`.
- 294 fetched compiler, header, fixture and harness blobs verified before building. Compiler target uses the eight C++ sources listed by the merged CMakeLists, built with Debian GCC 14.2.0, C++17, -O1 and -DNDEBUG, linked against LLVM 19.1.7.
- Compiler SHA-256 `2aea25276d6b0031ec07826b1d942a48cfb15366518a86b215d448963b122145`. Clang 19.1.7 linked the positive guest programs from actual compiler IR.
- Local run. The test commands and assertions came from the merged compiler's CMake registrations and tests/contract.py.

## LLVM repository regressions

```text
PASS native_try_finally_return_snapshot
PASS reject_caught_non_error_scalar
PASS reject_caught_non_error_string
PASS reject_caught_non_error_null
PASS reject_caught_throw_unwind_lifo
PASS reject_caught_throw_payload
PASS reject_caught_throw_nested_call
PASS reject_caught_throw_unsafe_defer
PASS reject_caught_throw_effect_signature
PASS reject_caught_throw_finally_call
PASS reject_caught_throw_array_size_operand
PASS reject_caught_throw_heap_owned_operand
PASS reject_caught_throw_defer_array_size
PASS reject_caught_throw_catch_array_size
PASS reject_caught_throw_finally_array_size
PASS reject_caught_throw_wasm32
```

Every negative required exit 1, the canonical Error diagnostic and no emitted LLVM IR. The try/finally positive produced an executable with exit 246.

## Shared corpus

Fixture revision `8a32ae0b9ab41de3c7d0576a3030ec0b49a7a913`. Each local file matched its Git blob. All negative fixtures produced exit 1 and zero stdout bytes.

| Fixture | Git blob | Outcome |
| --- | --- | --- |
| scalar_control.atto | `932810a6c0b17bf7b5fe95faa4282f1f1ec73a24` | Native executable exit 43 |
| caught_throw_integer.atto | `e0a2a1dd2b13d76ea3ca7b394af4c619a6f3b383` | Rejected with canonical Error diagnostic |
| throw_integer.atto | `9fa53dc9593332dfbb3834bbbfab4cf61c4d9a89` | UNSUPPORTED at the exceptional-control boundary |
| throw_string.atto | `eb8c14e27de7a5fefbb86166700578be06d0c679` | UNSUPPORTED at the exceptional-control boundary |
| throw_null.atto | `ae8b36ac771fc53f586e693865edf71f667c6d72` | UNSUPPORTED at the exceptional-control boundary |
| raise_integer.atto | `0d8f2b4d94ac144fe80b4220cbf643d73ddfa914` | UNSUPPORTED at the exceptional-control boundary |
| raise_string.atto | `409ade75eb5ae99e3fc1dec71ceb2b2b8e32bf88` | UNSUPPORTED at the exceptional-control boundary |
| raise_null.atto | `7f0b5825b5991a6d27fbf85fd622478562cd13ba` | UNSUPPORTED at the exceptional-control boundary |
| panic_integer.atto | `4e37ce1a98234e27d80c51008d35c55487e22fb5` | UNSUPPORTED at the exceptional-control boundary |
| panic_string.atto | `52a06fd418cbfdd4bed655fc2654054288b31b87` | UNSUPPORTED at the exceptional-control boundary |
| panic_null.atto | `02d8061cecd34e786d2b34e0064ac7eb5d2d0c2a` | UNSUPPORTED at the exceptional-control boundary |

The nine direct effects reached the general unsupported-effects gate before operand checking. Actor cleanup after suspension and supervisor CONTROL delivery remain NOT_EXECUTED.
