# Actor-tree v1 conformance contracts

Versioned wire-format contracts are intentionally separated from operational
proof obligations. The three `schemas/*.schema.json` files are normative
Draft 2020-12 validation for:

- physical-shutdown receipts with per-child native loan/cleanup obligations,
- monotonic lifecycle traces with stale-callback denial and parent DONE evidence,
- typed `self.forward()` / `self.backward()` pipeline envelopes with strict
  runtime/actor/incarnation identity, schema hashes and bounded scalar payloads.

`typespec/main.tsp` defines corresponding **structural** models and emits JSON
Schema. Extra JSON Schema conditionals and the chronological test validator
impose safety rules which the TypeSpec structural emitter alone cannot
express. JSON Schema validation does **not** establish runtime parity.

Run:

```bash
cd contracts/actor-tree/v1/typespec
npm install
npm run compile
npm test
```

The pinned toolchain uses TypeSpec compiler/JSON Schema emitter 1.17.0 and
Ajv 8.17.1. Nine positive/negative wire fixtures and three additional
semantic-order/ABA regressions are required. A green compiler emit is not
proof the LLVM backend implements the language features. Source actors must
still execute end-to-end without handwritten host callbacks for parity.

Model: `formal/actor-tree/TreePhysicalDone.tla`. On the runner,
`bash formal/actor-tree/check-tlc.sh` checks bounded parent/child
physical completion and two deliberately unsafe mutants.

## Hardening and proof boundaries (October 12, 2026)

The V1 `ActorIdentity` tuple is `(runtimeId, actorId, incarnation)`.
Do not concatenate identity fields using a separator; valid identifiers may
contain separators and would collide. The chronological validator encodes
the full ordered tuple and requires identical incarnations at STOP, resource
release, physical DONE, and parent proof.

The JSON Schema documents structure and local terminal conditions. Cross-event
and cross-child obligations are checked separately in
`typespec/validate-contracts.test.mjs`: a final native loan must have a
prior release event, pending lexical cleanup needs an explicit drain,
a parent may only cite distinct same-runtime child incarnations with
observed physical DONE, and no live event may follow physical completion.
A physically completed shutdown cannot still have a `pending` result.
Typed pipeline hops cannot target the same actor incarnation as their source.

The V1 `TaggedI64` wire model intentionally encodes only a signed
**32-bit subset** (the `value: int32` in TypeSpec and corresponding JSON
Schema range). Its name is legacy and **must not** be read as proof of
signed 64-bit payload parity. A separate versioned wire contract and
guest-execution tests are required for the LLVM/Java signed-i64 range,
including `INT64_MIN` and `INT64_MAX`.

The TypeSpec emitter carries structural limits (event/child counts, hop
bounds, and schema-hash shape), but conditional/relational checks remain
normative JSON Schema plus semantic verification. Bounded TLC safety
models do not prove implementation refinement, nor does a model pass
certify that a newer JSON Schema/TypeSpec revision has compiled.
