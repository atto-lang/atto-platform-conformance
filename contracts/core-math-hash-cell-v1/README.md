# AttoLang core/math + core/hash + core/cell portable subset v1

This contract supports backend-owned `.atto` sources with **behavioral**
parity, never mandates identical per-backend sources. Candidate builds:
[Java #1770](https://github.com/atto-lang/atto-source.java/pull/1770)
and [LLVM #869](https://github.com/atto-lang/atto-source.llvm/pull/869).

## Scope

- **Math:** i64 signed min, max, signum and inclusive bounds. Inverted
  bounds reject, including a typed error from backends exposing
  `clamp_int_checked`. Float rounding, transcendental functions,
  signed abs(MIN), checked/saturating add and exact numerical types are
  separate compiler contracts (see numeric spec #209).
- **Hash:** stable, deterministic byte stream fold with seed 17,
  polynomial multiplier 31, prime 1,000,000,007. Every step validates
  state and octet; error sentinel -1. No wrap, unsigned cast,
  architecture-specific shift or host hashing. This algorithm is
  **noncryptographic, collision-prone and unsuitable for adversarial hash
  tables**. Nominal `Hash.hash_value()` for arbitrary values requires
  distinct canonical serialization and hash-seeding design.
- **Cell:** the initial modules expose pure reader/writer policy and
  bounded reader count operations. **They do not implement a cell or
  interior mutability**. Genuine `Cell<T>`/`RefCell<T>` require
  compiler-sanctioned state layout, scope-bound loan tokens, no alias
  or escape across await/select, actor-locality where applicable,
  deterministic drop and runtime atomicity for any shared access.
  Pure predicates alone can never be used as synchronization.

The manifest has candidate metadata, fixed golden vectors and explicit
false certification fields. `test_oracle.py` runs a **source-free**
Python reference, not the Atto compiler:

```sh
python3 -m unittest discover -s contracts/core-math-hash-cell-v1 -p 'test_*.py' -v
```

Two import-prefix-specific `.atto` guest fixtures deliberately reflect
different backend compiler registries. Cross-backend parity is NOT claimed
until each real compiler executes a pinned fixture and records its head,
source/tree SHA, build provenance, observed result and nonzero runner steps.
Java, LLVM, Rust/Wasm, .NET, Wasm, Forge, Cranelift, JS and HDL do not share
a universal source-linked module admission today.

### Promotions

Exact-head executed compiler, guest and negative alias/lifetime checks;
source ownership and import provenance verified; Java JIT + Graal AOT,
LLVM x86-64 + freestanding profiles where supported, and distinct checks
for other backend capabilities. CI zero-step failures are NOT_EXECUTED.
Any private cross-org CI mirroring requires separately authorized guarded
export; this contract does not approve transfer.

### Namespace-based library files (additive)

Backend-local Core sources may declare `use namespace atto.core.math;`
and top-level `pub fnc` APIs instead of `define module math as ... end`.
This is source-unit namespace metadata only, not an import grant. The
.NET candidate validates the compiler-owned source unit and resource
digest; JS supports checked closed-world math compilation. Backend
capability and import syntax continue to be separately gated in the
[admission matrix](BACKEND_MATRIX.md); all guest results NOT_EXECUTED.
