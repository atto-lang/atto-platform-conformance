# Candidate: AOT-only profile-guided actor shard layout v1

**Status: HOST-ONLY REFERENCE, NOT_EXECUTED, NOT backend parity.**

This deliberately limited oracle records candidate heuristics for choosing
the physical layout of a **new** actor-owned homogeneous-double shard. It is
not an AttoLang source fixture, performance benchmark, permission grant, or
compiled guest. It does not authorize a CLR JIT, Java JIT, LLVM dynamic
code publisher, or a change to a live data region.

The matching .NET draft implements a bounded trusted-host policy and native
shard integration probes:
[.NET #542](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/542).
Related independent guards are
[Java #3131](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3131)
and [LLVM #1847](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1847).

## Candidate table and Rust-only oracle

`contracts/v1/aot-profiled-shard-layout-v1.tsv` lists fourteen source-free
scenarios. Columns are `id, rows, fields, lanes, row, column, random, expected`.
Observation order is row, then column, then random. Every observation is
capped by a total sample budget of 4,096. Invalid dimensions, invalid
power-of-two lane widths, or a logical byte count greater than 16 MiB
fail closed.

The reference is written in **Rust**, with no Python or third-party crates:

```sh
rustc --edition=2021 --test tests/aot_profiled_shard_layout_v1.rs \
  -o /tmp/aot_profiled_shard_layout_v1_tests
/tmp/aot_profiled_shard_layout_v1_tests
```

The negative vectors cover quota overruns, invalid tile geometry and
invalid fields. Positive vectors cover cold, row/column-dominant, random,
short-shard, tail-padding, and saturated-counter conditions.

## Security and performance boundaries

- Only the owner scheduler can authenticate a serial actor turn and record
  trusted observations. Numeric actor ID and incarnation alone are not
  capability proof.
- A candidate decision is just an advisory, never permission to move or
  reinterpret a live allocation or invalidate outstanding loans.
- AoS/SoA/AoSoA have single authoritative physical representations; tile
  padding is checked against the native allocation budget.
- The source code must be compiled **ahead of time**. Switching an already
  compiled kernel does not count as dynamic machine-code generation.
- Zero managed allocations in the sampling hot path is narrower than a
  zero-GC .NET process; do not infer either from this Rust host oracle.
- Heuristic agreement in this table is optional for other runtimes, whose
  optimizers may have different cost models. Safety, ownership and
  execution outcomes are the cross-backend invariants.

## Promotion gates

To turn this into a language feature, add actual byte-identical `.atto`
inverted-class plus AoS/SoA execution fixtures, the compiler-generated
layout metadata and one-of-three physical-layout selection, checked
ownership/loans, and exact-head execution on Java, LLVM and .NET Native AOT.
Test the output and failure semantics, target architecture, source Git
blob identity, native allocation/GC evidence and required independent
review. Until then every backend remains **NOT_EXECUTED** for this contract.
