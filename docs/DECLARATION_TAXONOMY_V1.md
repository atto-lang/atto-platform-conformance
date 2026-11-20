# Declaration taxonomy / hierarchy policy v1 (proposal)

**Status: source-free policy model only — no compiler execution, no five-backend parity.**
This matrix binds syntax proposals to soundness obligations, not to accepted source syntax.
Run `node --test tests/declaration-taxonomy-v1.test.mjs` with Node 22.

The Rust Cranelift stage-0 executable compiler supports scalar `main` only. LLVM admits
a restricted type-only `declare type/trait/interface` subset, while Java has
independently evolving actor, trait and module rules. Do not treat admission
as code generation. No backend is marked PASS here.

## Canonical semantic choices

- `class`: one concrete parent, independent implemented interfaces/traits.
  This is a proposed tightening of historical multiple-parent source behavior,
  not a parser change or a reason to silently reject already-accepted projects.
- `actor`: sealed actor-domain parent only, same isolation/transport policy;
  at most one effective state schema and no user persistent fields elsewhere.
- `supervisor`: compiler-owned CONTROL role, not a source-level substitute
  for a class, user trait or an ordinary actor with forged lifecycle authority.
- `state container`: owner-bound mutable state + synchronous methods using
  exclusive/read state loans; no implicit mailbox, sharing, persistence or FFI.
- `grain`: optional future contextual sugar for keyed virtual `GrainActor<K,S>`;
  actor isolation plus activation/passivation/epoch fencing, never direct state access.
- `model`: immutable validated computation graph, separate from mutable
  training parameter stores; models do not inherit arbitrary class state.
- `enum`, `struct`, `record`: distinct nominal/value layouts; no concrete
  class inheritance. Immutable records have no mutable fields.
- `interface` inherits interfaces; `trait` composes traits; implemented traits
  have no instance-state side tables and cannot confer runtime capabilities.
- `protocol` is reserved as a potential wire-schema descriptor, not yet part
  of the compiler grammar.

`implements` should be the canonical relationship to pure interfaces and
traits once the compiler retains their **distinct nominal kinds**. Do not
overload callable `with` effect syntax with trait inheritance. An interface
or trait does not grant `gpu`, `ffi`, `supervise`, `io` or CONTROL rights.

50 source-free reference decision vectors in the JSON are tested for unknown
parents, multiple superclass edges, actor isolation changes, side storage, state
loan escape/suspension, reserved intrinsics, capabilities, and keyed identity.
Passing this reference checker does NOT prove any Oreslang source accepts,
rejects, compiles, runs, migrates or survives AOT/hot-load on any backend.

## Next hardening gates

1. Reconcile existing language implementation and planned breaking single-parent
   rule; write both acceptance and rejection Oreslang guest fixtures.
2. Pin exact source Git blobs (including positive executable controls) for Java,
   LLVM, Wasm, Cranelift and .NET and optionally Forge.
3. Test source parsing/type checking; require stable intent-based diagnostics,
   ABI/type identity and no forged capabilities across imports and reloads.
4. Add runtime/guest execution for *supported* kinds with state-loan borrowing,
   cancellation, reentrancy, identity, resource budget and generation probes.
5. Require nonempty actual compiler CI steps and exact HEAD evidence per backend;
   fail closed and leave status NOT_EXECUTED otherwise.

Existing candidates: `oreslang-compilers-parity-testing#12` and
`oreslang-platform-conformance#235` address mutable-state regions; Java
`#2423` explores guarded supervisor semantics on a separate draft branch.
