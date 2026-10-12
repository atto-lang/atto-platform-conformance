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


## Trusted verifier authority and schema integrity

`verifyRoundTrip(trace, authority)` is fail-closed. The `authority` object
must originate **outside the untrusted trace** and include:
`expectedPipelineId`, `expectedRoute` (three runtime/actor/incarnation
tuples), and `expectedSchemaHash`. The verifier refuses undeclared wire
fields even when the calling code has not run Ajv separately. Never construct
the authority object by copying identity or schema-hash values out of the
untrusted message being checked.

`expectedSchemaHash` must equal the published V2 schema's SHA-256:
`f0f5740526408574c0271013451a8ab2c46aa091994ba393a5b501ce00b884c3`.
This is the SHA-256 of the **exact UTF-8 bytes** of
`schemas/typed-pipeline-roundtrip.schema.json`, including its newline.
The CI digest test recomputes this value; source edits require a new versioned
contract rather than silently changing the V2 hash. The hash binds message
shape to the versioned schema; it does **not** authenticate remote actors.
A genuine runtime must independently authenticate actor incarnation authority
and delivery ownership.

The V2 TLC model separately excludes guest deliveries after STOP. The fourth
intentionally unsafe mutation publishes a post-stop delivery while preserving
the ordinary delivery-count equality, so `NoPostStopDelivery` must fail.
The independent bounded explorer confirms the same counterexample.
No bounded model establishes compiler/runtime refinement or general liveness.
