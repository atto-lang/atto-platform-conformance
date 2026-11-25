# Nominal enum hardening and five-backend parity gates — v1

**Normative target and source fixture inventory, not an executable backend-parity claim.**

Target backends: Java/GraalVM, LLVM, WASM, .NET Native AOT, Forge. Compiler admission, runtime representation, methods, and wire serialization must be verified separately.

## Required language behavior

- `define enum E as ... end` creates a closed, **nominal** sum. Case identity includes the resolved module/package enum owner and case. Neither integer tag, case spelling nor payload shape substitutes for owner identity. Two enums may both use `Ready = 1` without being interchangeable.
- Each case has zero or one typed payload; a tuple or record is one structured payload. Constructor arity, width, type and ownership are checked; a payload-case descriptor is not an instance. `E.Nullary()` is staged Java syntax; bare `E.Nullary` singleton syntax needs a separate verified lowering path.
- Wire tags are stable positive signed 32-bit integers (1 through 2147483647), implicit tags start at 1 and advance from the preceding tag, explicit tags must be strictly increasing. Duplicate, zero, negative, overflow, decreasing and string-valued tags fail closed. Published tags require a schema lock and migration policy.
- Matching evaluates a scrutinee once, tests nominal owner/case before payload, rejects unknown and foreign cases even under a wildcard, requires exhaustive closed-domain coverage, rejects duplicate/unreachable unconditional arms and does not treat guarded cases as complete coverage. Payload bindings respect lexical scope and checked move/borrow lifetimes.
- Enum methods are permitted by language design as static callable slots with checked receiver, ordinary effects and visibility, snake_case naming and no hidden receiver in explicit arity. Method parsing, dispatch and override rules require dedicated compiler/guest fixtures: they are **not** covered by the initial 14-case matrix.
- Equality/hash include owner, case and recursively comparable immutable/frozen payload. Wrapping a borrowed pointer, mutable key or capability in an enum does not make it hashable, Sendable, Serializable or actor-safe.
- LLVM zero-GC target requires no mandatory heap allocation for nullary/scalar cases, bounded aligned inline layout and deterministic move/drop. Unsafe recursive or heap-backed cases fail closed until their explicit ownership implementation is proven.
- Portable actor/network codecs must independently prove canonical owner/schema/version/shape, stable discriminants, width-preserving payload, bounded decode and unknown-tag rejection. Local construction is never a wire codec proof. No native pointer, Java host object or host enum ordinal is a portable message.

All entry points (parser, forged AST, imported definitions, type checker, optimizer, AOT linker, and runtime decoder) reject invalid metadata; fail-open unknown discriminants are prohibited.

## Verification boundary

`contracts/enum-semantics-v1.json` pins the Git blob SHA of each `fixtures/enum/v1/*.ores` file. `npm test` checks that inventory and **does not execute an Oreslang compiler**. Every production backend is initially unconfirmed. To promote, use an independently approved compiler exact source SHA/tree and executable hash, real guest execution of positive sources with byte-exact stdout, semantic negative diagnostics for all reject cases (not generic parse errors, compiler crashes or an unsupported-feature response), and nonempty independently reviewable CI steps. Publish full logs and exact fixture blob identities, and add boundary/decoder tests before wire claims.

Relevant drafts: [Java nominal ADT #623](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/623), [Java focused enum integration #1647](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1647), and [LLVM enum AOT policy #575](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/575). Do not overwrite current-main compiler files with stale draft blobs. No cross-org private source copying without reviewed authorization.
