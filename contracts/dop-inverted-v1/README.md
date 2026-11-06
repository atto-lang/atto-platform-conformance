# Canonical AttoLang inverted two-i64 guest contract v1

This folder contains byte-identical source fixtures from the independent
Java/GraalVM and LLVM implementation branches, not new compiler code.

| Fixture | Git blob SHA-1 | Required observed behavior |
| --- | --- | --- |
| `swap-reuse.atto` | `8f5599a9e0b11ded2929110b4936441fceb2ef21` | Actual compiled native process exits 42 |
| `removed-index-trap.atto` | `c3c87cfd2515707932734e183bb5768436526a96` | Actual compiled native process terminates with SIGILL/SIGTRAP |

`manifest.json` declares **NOT_EXECUTED** for Java, LLVM, .NET, Wasm,
and Forge until verified exact-PR-head guest evidence is independently checked.
`test/dop-inverted-canonical-source-v1.test.mjs` is a source-free
integrity check only; its success must never promote backend capability.

- `inverted struct` is a nominal value row with one-level scalar column
  inversion. Nested ordinary fixed-record fields remain packed.
- Dense indexing after erase is not an opaque owner-issued, generation-fenced
  row handle; this v1 suite cannot prove ABA or stale-handle safety.
- No implicit compiler fallback to `Array<Row>`, Java `Object[]`, AoS or
  tracing GC is authorized for a requested inverted layout.
- No actor, suspension, field-loan, AoSoA, SoAoS, GPU, method, generic, or
  public class identity behavior is certified by these two fixtures.

**Release prerequisites:** head/tree/blob correlation, trusted runner
admission and nonzero executed steps, source-built compiler identity, native
artifact output, positive exit and real signal proof, sanitizer/effect/borrow
tests, independent review, and protected main branches. The core source
semantics must be implemented in canonical `.atto` libraries; Java/C++ host
implementations are limited to low-level compiler/runtime/ABI mechanisms.
