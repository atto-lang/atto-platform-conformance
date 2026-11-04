# AttoLang parity receipt v2

Receipt v1 remains readable for legacy evidence but is intentionally **not**
eligible for the five-backend scalar-core contract. It could only encode
negative compile rejection, required stdout for positive values, and omitted
the produced guest artifact digest.

Receipt v2 adds the minimum cross-backend fields needed by
`attolang.scalar-core.v1`:

- `artifact_sha256` binds the produced guest artifact independently from the
  compiler executable digest.
- Positive cases record canonical signed-i64 `result_i64` and
  `expected_i64` plus an explicit result channel. The value contract is
  independent of whether the backend observes a native return, process exit,
  stdout, Wasm export or host call.
- Negative cases declare `failure_stage=compile|runtime`. Compile negatives
  must reject before guest execution. Runtime negatives must compile,
  execute, and finish with `runtime_outcome=trap|error`.
- The validator still requires a successful job with a positive executed-step
  count and exact source head/tree/compiler identifiers.

`validateScalarParityReceipt()` requires v2. The generic
`validateParityReceipt()` still accepts v1 but returns
`scalar_core_eligible:false`.

This validator checks internal consistency only. It does not authenticate
GitHub metadata, runner identity, compiler provenance, artifact bytes, or
source ownership and never makes a receipt publicly promotable by itself.
