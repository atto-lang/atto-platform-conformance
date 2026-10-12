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
