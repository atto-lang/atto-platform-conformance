# AttoLang annotations v2 — target, phase and authority contract

Status: **candidate specification, not implemented compiler parity** (2026-11-06).
Source language name is **AttoLang**; existing `.ores` sources and Oreslang-named repositories remain compatibility surfaces. New canonical sources should use `.atto`. The machine-readable inventory lives at `contracts/annotations/annotation-targets-v2.json`.

## Architectural decision

Annotations are **typed compiler declarations**, not untrusted strings, Java/C# reflection attributes, runtime permission grants, or general-purpose user callbacks. Resolve the package-qualified annotation identity in the compiler; validate the declaration version, supported target, phase, typed constant arguments and explicit repeatability. Unknown semantic annotations, unknown argument names, unsupported targets, and unimplemented lowering fail closed. Nothing may disappear during AST/HIR/MIR lowering without a recorded consumer/proof.

**Every annotated surface must have an AST storage slot before it is admitted.** Parser acceptance without preservation, semantic checking and backend lowering is a bug, not an implementation.

### Target inventory

| Surface | Intended policy | Current audited Java baseline |
| --- | --- | --- |
| Package/module | Registered compile-time source metadata only; no implicit access to resources | Module can preserve `@BuildMetadata`, but opaque names still need registry hardening |
| Class, struct, enum, variant | Documentation, derive, layout, serialization, deprecation as explicitly permitted | Class annotations rejected for discarded AST; nominal struct/enum implemented only in separate draft stacks |
| Actor/isoactor | Bounded mailbox, group/topic and supervision metadata; no permission grants or shared mutable state loopholes | Actor declaration annotations rejected for discarded AST; actor-state safety must precede lowering |
| Interface/trait/contract, type alias | Static contracts and source metadata, never surprising runtime dispatch | Source declaration AST does not store general annotation metadata |
| `fnc`, `routine`, class method, static method | Static effects, ABI, test, optimization hints, return contracts | Selected annotations are retained; no general typed registry |
| Constructor, field, actor-state field | Schema/derive/validation; actor-state annotations subject to actor ownership | Constructor and field annotation lists exist; `@FromJson` is selected field lowering |
| Interface member, parameter, return type | Per-slot constraints, return contract, borrow-safe typed checking | Member/parameter AST lacks full annotation slots; `@Ret` only works on callable declaration |
| Generic parameter, local, type-use, lambda | Compile-time constraints, refinement/ownership metadata; no capture-boundary escape | General annotation support not implemented |
| Macro | AOT-only hygienic expansion with bounded resources | General annotation registry and hygienic build-time derivation are pending |
| Import | No annotation effect; import/package authority must be resolved separately | Must remain unsupported |

The full inventory contains 28 distinct targets. The current v2 manifest marks other backends **reject_unimplemented**; this is a policy expectation, not a claim that each actual compiler already meets it.

### Proposed AttoLang syntax (NOT yet parser-supported)

```atto
@deprecated(since: "2.0", note: "use NewCounter")
define class OldCounter as
    @serde(name: "count")
    count: i64;

    @must_use
    pub read(): i64 { return self.count; }
end

@derive(Eq, Hash, JsonCodec)
@data_layout(kind: soa, block: 32)
define struct Particle as
    position: f32;
    velocity: f32;
end

@serde(tag: "kind")
define enum Event as
    @serde(name: "started")
    Started;
    Stopped(i64 code);
end

@actor_policy(mailbox_limit: 1024, serial: true)
define actor Worker as
    @refine(min: 0)
    private count: i64;

    @requires(Capability.NetworkSend)
    pub suspends send(i64 n): void { /* validated body */ }
end

@test
fnc example(): void { /* test body */ }
```

The `name: value` spelling is the **proposed canonical named-argument grammar** aligned with AttoLang named calls. Existing parser code uses a limited `name=value` form in annotation arguments; migration requires an explicit compat decision and corpus, not a silent syntax flip. This example is illustrative, not runnable compiler evidence. `critical` and `suspends` are source effect/ownership contracts, not permissions an `@Critical` or `@async` decorator can fabricate.

A user-defined schema may eventually look like:

```atto
define annotation WorkloadClass for fnc, method
    phase source_metadata;
    repeatable false;
    name: string;
end
```

This declaration syntax is likewise **design-only** until the compiler implements annotation identity resolution, schema inference and protected symbol ownership. User-defined macros are not allowed to grant `unsafe`, CONTROL authority, FFI, cross-tenant access, or a Sendable proof.

## Phase ordering and typed semantics

1. Resolve imports and the package-qualified annotation definition; reject misspelling, shadowing of built-in security/ABI directives, aliases impersonating reserved namespaces and ambiguous bindings.
2. Parse into immutable AST with source spans and target identity. Preserve named/positional arguments without losing duplicates. Validate target, cardinality, repeatability, and constant-expression budgets. No runtime actor, I/O, randomness, clocks or network during evaluation.
3. Apply only registered SOURCE_METADATA / COMPILE_FILTER / AOT_DERIVE passes. Expansions are hygienic, deterministic, resource-bounded, and run **before** type, effect, borrow and ownership validation; expanded declarations are checked again.
4. TYPE_EFFECT annotations may **require** proofs, never mint capabilities. `rt borrow`, `rt share`, `rt take`, `rt copy` and actor Sendable checks remain enforced by core compiler rules. An annotation cannot make functions/closures serializable channel data or permit actor state escape.
5. ABI and OPT_HINT metadata pass through typed IR to consumers only with a certified target layout, calling convention, pointer/ownership guarantee and stable version. Optimization hints may be ignored only when the annotation schema explicitly says they have no semantic effect.
6. Runtime retention defaults to **none**. Any opt-in runtime metadata uses an explicit versioned, nonreflective, capability-checked section; no Java/C# reflection rescue path in NativeAOT, LLVM, Wasm or Forge.
7. Incremental builds and hot upgrades fingerprint resolved annotation identities/versions, typed arguments, expanded declarations and effect/ownership proofs; generation changes invalidate stale optimization and authorization caches.
8. A compiler or backend that cannot complete an effectful annotation must error **before emitting or publishing executable IR, CIL, Wasm or native binary**.

## Required hardening matrix

- **Placement:** class, nominal struct, enum and variant, actor/isoactor, interface/trait/contract, type alias, method/static method/constructor, `fnc`/`routine`, field/actor state, parameter, generic parameter, type-use, local binding, lambda and module; reject imports.
- **Parsing:** duplicate/repeatable policy, case-sensitive package-qualified identity, duplicate named args, positional/named collision, missing/wrong typed arg, bounds/size/depth limits, trailing annotations, string/comment decoys, Unicode spoofing, deterministic canonicalization.
- **Soundness:** a derive cannot bypass method visibility, nominal ADT exhaustiveness, mutable alias isolation, channel Sendable data restrictions, actor turn nonreentrancy, borrower lifetimes, scheduler/CONTROL quotas or `critical` suspension prohibitions.
- **Code generation:** AOT-only expansion and source-spans; no emitted executable artifacts on rejected input. Inspect actual lowered code for ABI and layout contracts; host-only metadata tests are insufficient.
- **Security:** permission-demand vs permission-grant adversarial cases; fake `@Trusted`, `@Unsafe`, `@AllowAll`, `@ActorMaxThreads`, `@RequiresPermission`, injected state, FFI and GPU kernel effects cannot change security admission.
- **Lifecycle:** hot reload fingerprint invalidation, closed-world dependent recompilation, generation fences, stable actor reference identity, and deterministic side-by-side rebuilds.

## Milestones and promotion requirements

**M0 — source integrity:** preserve every accepted annotation at its exact target in typed AST/HIR; add registry/versioned schema and duplicate/target/argument negative tests. No expanded source reaches execution without checked consumer.

**M1 — executable Java semantic slice:** first enable source-metadata and a narrowly defined schema-only field/struct annotation with real JUnit, GraalVM and guest execution proofs. Add class/actor/enum AST retention only when semantic checks and lowering are wired; do not merely delete the current rejection guard.

**M2 — cross-backend native slice:** choose one universally supported annotation (such as a compile-time `@must_use` constraint), implement identical negative and positive fixtures for Java, LLVM host+wasm32, .NET NativeAOT, Wasm, and Forge. Continue fail-closed unsupported profiles.

**M3 — AOT derive / ABI / effects:** safe serialization derive, data layout, actor policy, capability requirements, test and GPU annotations, then hygienic user-defined compile-time annotations. Prove no runtime reflection, hidden allocation, unsigned authority escalation, or stale proof cache.

For each promoted feature: attach exact `source_sha`, `source_tree`, `compiler_sha`, `compiler_tree`, backend toolchain/digest, nonzero executed runner steps, positive guest outputs, negative compiler diagnostics with **no artifacts**, and independent review. A job with `steps=[]` or `steps=null` is **runner admission failure**, not a passing compiler or runtime test.

## What is actually verified here

The Node validator and adversarial tests shipped beside this contract **validate the manifest's shape and refusal to promote unaudited claims**. They do **not** run AttoLang compiler source or provide guest parity. Existing draft annotation admission PRs remain separate prerequisites:

- Java [#2275](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2275)
- LLVM [#1173](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1173)
- Wasm [#176](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/176)
- .NET [#247](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/247)
- Forge [#133](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/133)

No private compiler source is copied to a carrier organization by this specification.
