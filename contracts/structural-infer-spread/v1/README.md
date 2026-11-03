# AttoLang structural / infer / aggregate spread v1

Status: **proposed conformance contract; NOT four-backend executable parity**.

**Evidence-class separation:** The 13 `contracts/structural-infer-spread/v1/manifest.json` positive cases are callable-local examples with no `pub fnc main`; they are **source-only type/ownership obligations**. Their stage is `source-contract-only`, never `compile-and-execute`. The independent `fixtures/structural-infer-spread/v1/` corpus contains 8 runnable `.atto` positive guests with distinct expected integer results and 8 compiler-rejection guests. Its SHA-pinned fixture-integrity Node test does not execute these guests or certify a backend. Promotion requires exact compiler/source/tree/artifact evidence and an actual executable runner with non-skipped steps.

This contract is a targeted companion to the already-merged `oreslang-common-source/contracts/v1/IMMUTABLE_AGGREGATE_SPREAD_V1.md` and structural shape rules. Existing Oreslang repository names and source suffix `.ores` remain valid during AttoLang rebranding.

## The three distinct operations

- `infer struct{a: 1}` constructs a new, exact concrete inferred struct shape. It does not create a new nominal declaration, erase a named struct's identity or grant structural matching to an unmarked named parameter.
- `infer record{a: 1}` constructs a new readonly, shape-typed record. Use `infer` for canonical inline inferred aggregates; legacy `record{...}` remains a compatibility spelling until formatter/grammar migration is separately approved. Explicit typed `struct{x: int}{x: 1}` needs no `infer`.
- `structural {a: int}` in a parameter or matching context is a **readonly view/loan** over public compatible members. It is not an aggregate constructor and never implicitly converts a nominal struct, class or actor into a record. Do not accept `infer structural` as construction syntax.

```ores
fnc get_id(structural {id: int} value) -> int {
    return value.id;
}
fnc example() -> int {
    const original = infer struct{id: 40};
    const expanded = infer struct{...original, label: "new", id: 42};
    const snapshot = infer record{...expanded, enabled: true};
    return get_id(snapshot);
}
```

The inferred shape of `expanded` is exactly `{id:int, label:String}`; that of `snapshot` is `{id:int, label:String, enabled:bool}`. `original` remains valid because all projected fields are Copy-safe in this example. The result of `get_id(snapshot)` is 42 if the backend implements this entire contract.

## Binding and safety

1. Parse an ordered list of named fields or `...expression` spread operands. No fake AST keys, host-map enumeration, runtime reflection or dynamic shape widening.
2. Infer each spread's accessible **closed static field row**; apply items in lexical order. The rightmost spread or explicit assignment wins. A later value may change a *new inferred* result field type; an explicitly declared struct's fixed field types may not change. Duplicate **explicit** named fields in one literal reject, even across spreads.
3. Evaluate every operand exactly once from left to right, including an overridden field's effects. Build a fresh aggregate and publish only on complete success. Check exact final fields, tags and source/target ownership. On exceptional/cancellation paths clean temporary ownership exactly once.
4. Preserve public/member visibility, nominal identity, layout differences and borrow checker rules. A structural view is readonly, nonescaping and not an actor-transmittable authority. A `...source` read may copy only fields whose Copy proof is valid; move-only/borrowed/capability fields require explicit separately verified ownership paths, not implicit duplication.
5. Keep inference compile-time. A structural shape's identity is order-independent; deterministic storage/ABI field order is sorted by Unicode scalar key values, but observable initializer evaluation remains source-ordered. A backend must independently validate type, ownership and lowering provenance rather than treat the manifest as proof.
6. AttoLang `with` remains a separate immutable update expression; spreading is construction. `Map` stays dynamically keyed and cannot satisfy closed aggregate spread.

## Required release evidence

Every one of **Java/GraalVM, LLVM native, .NET NativeAOT, and Wasm** must compile and run all applicable accept fixtures at an exact pinned source/compiler head, and reject every negative fixture before producing releasable artifacts. Rejecting unsupported constructs is a valid safety boundary but **not** positive feature parity. The manifest deliberately records no verified execution. The Node tests check contract integrity and deterministic row algebra only; they are **not** compiler or guest tests.

LLVM/native must additionally run ownership, sanitizer and linked binary checks. Wasm must execute an actual wasm32 guest rather than treating an LLVM host result as Wasm evidence. .NET must build actual CIL/NativeAOT and run the produced binary. Java must check parser, types, ownership, formatter and synchronous/suspendable Graal paths.

The existing shared spec permits extra ownership-safe forms beyond the conservative current Java and LLVM draft subsets. Do not broaden backend admission just to satisfy a manifest when cleanup, borrow, or actor-domain proofs are missing.


## Versioned .atto guest-source matrix

The source-committed corpus lives at `fixtures/structural-infer-spread/v1/`:

- Eight positive source programs with **distinct** expected guest integer results 42 through 49. These exercise inline inferred structs/records, extension, rightmost-wins type replacement, preservation of the original record, multiple spreads, explicit cross-kind construction, and readonly structural projection.
- Eight negative programs which must receive a compiler-owned rejection **before** any releasable IR, native binary, Wasm module, or CIL artifact is published. They cover duplicate static keys, unknown spread operands, scalar spread, invalid `infer` targets, `infer structural` misuse, mutable borrow capture, extra fields in explicit exact-struct construction, and structural-view mutation.
- `fixtures/structural-infer-spread/v1/manifest.json` records the exact Git blob SHA-1 for each .atto source. The `tests/structural-infer-spread-fixtures.test.mjs` source-free gate checks all fixture bytes and rejects unverified success flags, duplicate identities, changed expectations and same-constant result oracles.

Run source-free checks using:

```sh
node --test tests/structural-infer-spread-contract.test.mjs tests/structural-infer-spread-fixtures.test.mjs
```

**Important:** These Node checks are fixture integrity and semantic-oracle tests, not native guest execution. The backend evidence remains false pending real Java/GraalVM, LLVM native (both `-O0` and `-O2`), .NET NativeAOT and wasm32 programs at exact head. Ordinary CI failures before job-step creation do not count as execution. Any future private cross-org source mirror requires protected-source review, explicit allowlisting, destination privacy/ID and workflow pins, resolved security incidents where applicable, and complete Git-tree SHA verification; a successful source-free carrier canary is only runner-availability evidence.
