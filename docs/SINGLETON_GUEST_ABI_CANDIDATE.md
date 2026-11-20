# Singleton/shared-table guest ABI — design candidate (not admitted)

This proposal is **not** the v1 conformance contract, not executable Oreslang guest source, and not a claim that any compiler now lowers or executes `define singleton`. Its wire-neutral names identify type/effect requirements; syntax remains unratified.

## Type and authority boundary

- Singleton declaration ID is resolved from module + declaration identity by compiler/linker, stable across import aliases, scoped to the application-domain incarnation. Guest source cannot pass numeric IDs.
- A singleton initializer publishes **exactly once** and only after success. Failure is sticky. Cycles and cancellation must not deadlock, duplicate initialization, or publish partially initialized state.
- Publication requires a **deeply immutable** value; actor-private or mutable reachable aliases are rejected statically. Prepublication `self` cannot escape. Compilation must track borrows, generics, containers, closures, calls, and effect transitivity.
- Table identity and capability are opaque, issuer-bound to live actor incarnations. No guest constructor, FFI argument, or serialized token can mint caller identity or change grantee/rights. Only the runtime scheduler supplies the caller lease.
- Fixed positive slot capacity, exact signed i64 keys and values, atomic single operations and checked overflow with no partial mutation. Ownership is retired automatically on actor close/restart/destruction.

## ABI operation candidates

`lookup`, `insert`, `insert_new`, `compare_exchange`, `update_counter`, `erase`, `delegate`, and `close`. Guest operations return explicit `Result<..., TableError>`, with `Option<i64>` for a missing lookup value. No `null`, implicit coercion, operator[] overloading, or nested Future/Option auto-flattening. No public API may expose `ActorContext`, raw pointers, declaration IDs, or lifecycle notifications.

**Important unresolved choice:** whether guest table operations are sync-within-a-carrier-free critical section or expose asynchronous suspension depends on bounded scheduler adapter proof. This design deliberately **does not claim hard RT, wait-free operation, worker transport, or source-level spelling**; the Forge host currently uses locks and reference-counting.

## First two source-semantic oracles

1. `singleton-prepublication-self-escape` must receive `ORES-SINGLETON-SELF-ESCAPE` from the **real compiler semantic checker**, not `ORES-SINGLETON-UNSUPPORTED`.
2. `singleton-mutable-alias-publication` must receive `ORES-SINGLETON-MUTABLE-ALIAS` from transitive ownership/type checking, not a token-string or host test.

Compile fixtures must be actual parser-produced AST and compiler-checked source, with diagnostic spans and immutable source/compiler digests. The negative cases are not yet runnable because all production backends intentionally reject the declaration earlier.

## Integration order

1. Agree on typed callable signatures and diagnostic IDs without enabling guest runtime paths.
2. Extend the production AST and type/effect/borrow checker to recognize singleton declarations in a gated **check-only** mode.
3. Add real positive declaration type-checking and the two negative AST semantic cases; keep production runtime emission disabled.
4. Implement runtime-backed exactly-once publication, sticky failure, alias identity and authority checks.
5. Move through the original 20 contract scenarios, per backend, using independent run/job/artifact receipts. Wasm uses pinned LLVM compilation; Forge host-only tests do not count.

No guest conformance status may change based only on this proposal or its schema validator.
