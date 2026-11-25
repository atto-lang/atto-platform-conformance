# Exact struct / readonly record acceptance fixtures v1

Source contract: Java draft PR #2181, stacked on #2180 and #2177. This corpus is **not** evidence of compiler, native-image or guest execution.

`struct { foo: int }` is an exact closed structural shape. `record { foo: int }` is a readonly structural shape. No implicit cross-kind substitution is allowed. Callable-prologue-only `type T = ...;` aliases are lexical and transparent, not nominal declarations.

Each positive case describes the expected parser/typechecker admission. Each `reject-` case must fail **before** LLVM IR, wasm artifacts or native binaries are emitted. Stages identify the earliest intended gate, not an executed result. Named constructor fields are evaluated exactly once in lexical expression order, independently of physical field layout. Positional `T{value}` is permitted only for single-field shapes. `inferred-struct-binding` is a target vector not yet certified even on Java #2181. A formatter must round-trip both aggregate kind and named-constructor evaluation order.

The validator checks Git blob SHA-1 pins and rejects fabricated backend success. `confirmedBackends` is intentionally empty for every fixture. A backend must provide an immutable exact-head run with nonzero executed test steps before making any success claim.

Full nominal local structs and independent local type identities are tracked separately under Java #2178; LLVM #1097's nominal work is not equivalent to these exact structural type shapes.
