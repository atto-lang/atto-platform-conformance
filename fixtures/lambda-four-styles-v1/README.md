# Four equivalent typed lambda header styles — target conformance v1

Canonical contract: atto-lang/atto-spec#149. Alternative local `const v`
declarations exercise type-first and name-first formals, inferred and explicit
`void` returns, and legacy `-> void { }` versus `: void -> { }`.
Each positive case invokes its callable and expects guest exit 42 **once a
backend actually supports it**. The malformed cases must fail without a guest
artifact. No backend has yet executed these fixtures in this suite; all matrix
cells deliberately say NOT_EXECUTED, including Atto self-hosted/HDL/realtime.

Host-only registry integrity: `node --test tests/lambda_four_styles.test.mjs`.
This confirms manifest/source consistency only, not compilation or execution.
Compiler admission, ownership/capture policy, codegen and same-behavior guest
execution must be collected at the exact backend PR head before claiming parity.
