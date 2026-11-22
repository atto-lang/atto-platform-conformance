# Core math/hash/cell cross-compiler admission ledger — 2026-11-22

This inventory records **what source and test machinery were committed**, not
executed compiler parity. The complete status is pinned in `manifest.json`,
including every independent source blob Git SHA-1 and exact candidate commit.

| Backend | Draft PR | Candidate admission | Guest status |
| --- | --- | --- | --- |
| Java | [#1770](https://github.com/atto-lang/atto-source.java/pull/1770) | Registered compiler-owned Atto modules | NOT_EXECUTED |
| LLVM | [#869](https://github.com/atto-lang/atto-source.llvm/pull/869) | Registered generated/baked Atto modules | NOT_EXECUTED |
| .NET | [#220](https://github.com/atto-lang/atto-source.net/pull/220) | SHA-256 pinned embedded Core source loader, proposed CIL test | NOT_EXECUTED |
| Wasm | [#283](https://github.com/atto-lang/atto-source.wasm/pull/283) | Owned source; scalar Wasm bridge still refuses imports | NOT_EXECUTED |
| Rust/Wasm | [#540](https://github.com/atto-lang/atto-source.rs/pull/540) | Owned source; module graph integration pending | NOT_EXECUTED |
| Forge | [#230](https://github.com/atto-lang/atto-source.forge/pull/230) | Owned source; stage-0 compiler has no module imports | NOT_EXECUTED |
| JS | [#137](https://github.com/atto-lang/atto-source.js/pull/137) | Math transpiler path, hash/cell source-only | NOT_EXECUTED |
| Cranelift | [#97](https://github.com/atto-lang/atto-source.cranelift/pull/97) | Owned source; JIT imports unsupported | NOT_EXECUTED |
| HDL | [#66](https://github.com/atto-lang/atto-source.hdl/pull/66) | Owned source; RTL imports unsupported | NOT_EXECUTED |
| Self-hosted Atto | [#21](https://github.com/atto-lang/atto-source.atto/pull/21) | Bootstrap-only source; no compiler | NOT_EXECUTED |
| Real-time | [#16](https://github.com/atto-lang/atto-source.realtime/pull/16) | Bootstrap-only source; no compiler or WCET proof | NOT_EXECUTED |

The portable subset is **not a general math package**: no IEEE transcendental
operations, arbitrary precision, checked abs(INT64_MIN), or full numeric
specification parity is claimed. The modulo-prime octet fold is noncryptographic
and not a Hash trait for arbitrary values; a complete hash map must consider
collision attacks and canonical per-type serialization.

`core/cell` today supplies non-authoritative borrow-state predicates only,
without compiler enforcement, real Cell<T> / RefCell<T>, atomicity, lifetime
tokens or deterministic cleanup. A passing reference oracle cannot change this.

## Promotion gates

Exact-head, stepful CI with compiler-built guest results; canonical import
identity/provenance, negative shadow/traversal imports, all-boundary numeric
behavior and real borrowing lifetime/reentrancy checks. Each backend may own
a different physical `.atto` implementation, and backend-specific unsupported
capabilities must remain explicit rather than invoking host-language helpers.
Never mirror private sources outside the source org without authenticated
export approval and full SHA/path/mode/tree verification.
