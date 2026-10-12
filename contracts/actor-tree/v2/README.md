# Actor-tree V2 — lossless signed-i64 typed pipeline contract

Normative [JSON Schema Draft 2020-12](schemas/typed-pipeline-roundtrip.schema.json),
structural [TypeSpec 1.17](typespec/main.tsp), and dependency-free semantic
[round-trip verifier](validation/verify-roundtrip.mjs).

V1's legacy \`TaggedI64\` encodes only an \`int32\` range. V2 represents every
signed 64-bit integer as a **canonical decimal string** to prevent precision
loss in JS/JSON consumers, including \`-9223372036854775808\` and
\`9223372036854775807\`. JSON Schema ensures canonical shape and length; the
semantic verifier uses \`BigInt\` for true signed-64 range checks.

V2's four-hop conformance fixture requires three distinct physical actor
incarnations exchanging two \`self.forward()\`-shaped hops downstream and two
\`self.backward()\`-shaped hops upstream. All hops must retain the same signed-i64
schema hash and nominal payload variant. Identity tuples cannot be collapsed
using separators. This is a **wire/protocol contract** only; a green contract
validator does not mean either backend has compiled and executed the fixture.

Run \`node --test validation/*.test.mjs\` without dependencies. To compile the
TypeSpec model, run \`npm install --ignore-scripts\` and \`npm run compile\` in
\`typespec/\` with package downloads enabled; require emitted-schema comparison
against the normative JSON Schema in funded CI before certifying emission.
