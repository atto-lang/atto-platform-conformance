# Actor-state borrow CFG / nine-backend conformance gate

**Status: model baseline only. No nine-backend executable parity is claimed.**

The companion `semantic-cases.json` is the same Git blob in each active
`atto-source.*` backend (Java, LLVM, .NET, Wasm, Forge, Cranelift, JavaScript,
Rust and HDL). Run:

```sh
node --test tests/borrow-mir-v1-contract.test.mjs
```

It checks 22 restricted *source-free* ownership CFG cases, bounded input
vocabulary, distinct owner/loan definitions, graph joins, and rejection of
unsupported operations or forged certification receipts.

## Evidence levels

A source-free model pass cannot establish that a real compiler emitted the
tested facts. Backend receipts must be independently bound to an exact
source commit, Git tree, Git blob inventory, compiler-produced typed-MIR
inventory, emitted instructions/diagnostics, executed runner steps, and
independent review. No self-reported `CERTIFIED` bit is trusted.

The Rust browser compiler draft PR #488 implements **restricted source-derived
V0 flat guards and V1 literal-condition four-block diamonds**, checked against
the standalone canonical Rust checker draft PR #46. Its exact-source private
run [44946623658](https://github.com/ores-data-platform/atto-ci/actions/runs/44946623658)
also proves the default-thread-stack 250-link addition regression now passes.
This is `HOST_ONLY`, **not** full typed CFG/NLL or guest certification.

## Native evidence audited 2026-11-21

**All nine share the exact source-free contract blob; NONE has general
compiler-authenticated typed MIR/NLL and guest parity certified.** The table
separates evidence that was actually executed from source-authored fixtures:

| Backend | Verified in this audit | Proven limit | New draft |
| --- | --- | --- | --- |
| Rust (`.rs`) | Bounded flat/diamond source-derived CFG with independent canonical Rust verification; browser host default-stack parser regression passed | `HOST_ONLY`; no general MIR/NLL or actor guest | [#488](https://github.com/atto-lang/atto-source.rs/pull/488) |
| Java (`.java`) | Nine-backend contract source aligned byte-for-byte | No Java native compiler/guest run in this audit | [#1726](https://github.com/atto-lang/atto-source.java/pull/1726) |
| LLVM (`.llvm`) | Existing nine-backend contract source aligned | No LLVM native compiler/guest run in this audit | Existing backend work |
| .NET (`.net`) | Existing nine-backend contract source aligned | No CIL/NativeAOT native borrow CFG run in this audit | Existing backend work |
| Wasm (`.wasm`) | Actor-state unsupported syntax rejects at bounded source preflight, **16/16 native source-policy tests executed** | `HOST_ONLY` preflight; no compiled actor Wasm guest | [#263](https://github.com/atto-lang/atto-source.wasm/pull/263) |
| Forge (`.forge`) | Existing nine-backend contract source aligned | No Forge native compiler/guest run in this audit | Existing backend work |
| Cranelift (`.cranelift`) | Existing nine-backend contract source aligned | No Cranelift native compiler/guest run in this audit | Existing backend work |
| JavaScript (`.js`) | Actual JS scalar compiler refuses actor-state guest source, **2/2 native compiler-denial tests executed** | Negative admission only; no positive actor ESM | [#115](https://github.com/atto-lang/atto-source.js/pull/115) |
| HDL (`.hdl`) | Actual HDL compiler refuses actor-state source before RTL emission, **2/2 native compiler-denial tests executed** | Negative admission only; no hardware loan proof | [#47](https://github.com/atto-lang/atto-source.hdl/pull/47) |

All 20 source-free conformance test assertions passed on
[GitHub Actions 44947329224](https://github.com/ores-data-platform/atto-ci/actions/runs/44947329224).
The same private runner passed 2 JS, 2 HDL and 16 Wasm actual source negative
tests; **154/154 tracked files were Git-SHA inventoried**. Rust's default-stack
250-addition/3000-operator regression passed on
[run 44946623658](https://github.com/ores-data-platform/atto-ci/actions/runs/44946623658).

The separate 92-target Rust browser test carrier still has **90 passes / 2
fails** on [latest exact source head run 44947522302](https://github.com/ores-data-platform/atto-ci/actions/runs/44947522302):
`fixtures` (partial mirrored pass/fail corpus count, NOT a current stack
overflow) and `private_ci_policy_contract` (private policy workflow deliberately
not installed as an executable workflow in the alternate organization). Do not
report `92/92` or change test thresholds to conceal these gaps.

These are **audited run-specific observations**, not evergreen certification:
rerun on the latest exact backend PR heads after any source change. No backend
is tagged `CERTIFIED` by this note. The source-free JSON manifest remains
`NOT_EXECUTED` for full compiler-derived CFG/NLL semantics.


`atto-source.atto` and `atto-source.realtime` are presently minimal
repository scaffolds, not functional additional compilers.

## Required native parity progression

1. Accept/reject the same canonical positive and negative `.atto` sources
   inside each backend's real parser and type checker.
2. Verify dynamic branches, independent read/write loan rights, last-use
   lifetimes, joins, loops, suspension, exceptions and cancellation; if
   unsupported, issue a stable diagnostic **before** code emission.
3. Cross-check real compiler-generated MIR with canonical Rust, not a
   separately invented fixture report.
4. Verify actual guest/native execution, including negative emission denial.
5. Maintain exact-head private CI and independent human/AI reviews under the
   existing ready-cycle policy.

This contract is intentionally fail-closed until all of those proofs exist.
