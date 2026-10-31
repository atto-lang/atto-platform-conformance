# Zorde cross-repository conformance handoff v1 (source-free pilot)

This repository **does not** own the Zorde validator, TypeSpec declarations,
JSON Schema authority, or the WIT interface. Those live in the private
`ores-truffle-oreslang/oreslang-serialization-and-validation` repository:

- `contracts/zorde/main.tsp` — independently authored TypeSpec authority A.
- `contracts/zorde/authored.schema.json` — independently authored Draft 2020-12 authority B.
- `wit/zorde-validation.wit` — proposed Component Model interface, **not** a
  native implementation and **not** a replacement for JSON Schema constraints.

`schemas/zorde-contract-handoff-v1.schema.json` validates the shape of an
**untrusted report** referring to exact commits, trees, and Git blob identities.
It never downloads or republishes a private contract. It has three distinct
evidence lanes: independently compared TypeSpec/JSON Schema authorities,
WIT parser checks, and compiled native guest execution.

The schema allows only `NOT_EXECUTED`, `EXECUTED_UNATTESTED`, and `REJECTED`
per lane. A zero-step lane must have zero tests and null evidence; a reported
execution must have positive step/test counts and a nonzero digest. No lane can
self-report `VERIFIED`, and every structurally admissible report has the
fixed `STRUCTURE_ONLY_UNAUTHENTICATED` disposition and
`privateSourceExportAuthorized=false`.

**Important limits:** content-addressed identities prove neither authorization
to export source nor that the cited check actually ran. A digest in a
self-reported JSON document is not an authenticated artifact. A successful
independent schema comparison on finite probes is not a universal equivalence
proof. WIT parsing cannot establish canonical-ABI correctness, async safety,
borrow lifetime safety, or a valid Oreslang guest implementation. The schema
does not even claim that any trusted authority emitted the report.

## Pinned non-executable source snapshot

`evidence/zorde-contract-handoff.pending.json` records one inspected **source**
snapshot, not a verified execution:

- Source commit: `bafdbe8fd41aa7a220491acc03be4c6ce57a58fa`
- Source root tree: `8774cc6b4f817d469dd0bedca8301004917e3d9d`
- TypeSpec Git blob: `c5728bd100f1dd36007918038fe54610e0259268`
- JSON Schema Git blob: `0d8f3ca66952969e8aa9125e9ef427c313b89321`
- WIT Git blob: `8100dbe91514e38a11beea8070a5a5cfc6b639fc`

These identities were read through GitHub's connector at that exact source
commit. The pinned pending receipt is checked by a local schema test against
a fixed reviewed snapshot; it must not be automatically rewritten on upstream
changes. Independent cross-repository retrieval and authorization remain a
separate reviewed gate. Every execution lane is `NOT_EXECUTED`; no source
is mirrored into CI carriers by this fixture.

## Local source-free checks

With Python 3 and independently installed `jsonschema==4.26.0`:

```sh
python3 bin/check-zorde-handoff.py evidence/zorde-contract-handoff.pending.json
python3 -m unittest discover -s tests -p 'test_zorde_*_schema.py' -v
```

The CLI reads only bounded regular files (maximum 64 KiB), refuses final-component symlinks, hardlinks, duplicate JSON keys, nonfinite numbers and invalid schema claims. On success it prints the fixed `ZORDE_HANDOFF_SHAPE_ONLY_UNAUTHENTICATED` label. It does **not** authenticate the cited GitHub commit, tree, source blobs, CI execution, or private-source authorization. A same-UID concurrent writer could still race local reads: this is an admission parser, not an OS sandbox or immutable-file attestor.\n\nThe tests are synthetic positive/negative **schema tests** and are not evidence
that private source, TypeSpec, WIT, Rust, or Oreslang guest code ran.

## Promotion checklist (outside the schema)

1. Independently authorize any source placement and verify actual source
   repository visibility, intended destinations, immutable commits/trees,
   and complete dependency identities *before* any private source transfer.
2. Independently fetch the approved source commit and verify all three Git
   blob pins. Refuse symlinks, path substitution, and ambiguous authorities.
3. On an approved runner, validate authored TypeSpec and JSON Schema using
   independent validators and deliberately mutated negative fixtures. Reject
   unsupported keywords rather than silently dropping constraints.
4. Parse WIT with a pinned WIT parser, then separately run binding generation,
   component instantiation, ABI round-trips, ownership/borrow/drop and
   cancellation tests against actual compiled guests.
5. Independently check trusted run/job/step metadata, nonzero runner identity,
   source checkout SHA, commands, test counts and raw artifact digests. Obtain
   Java/LLVM/.NET/Wasm/Forge guest evidence separately; do not substitute a
   host-only oracle or a WIT syntax check for backend execution.
6. Apply a separately reviewed release policy. **Nothing** in this handoff
   schema changes a release gate, CI publisher, mirror allowlist, or branch
   protection.

The Zorde implementation may use its existing `std/zorde` and validation
registry with bounded inputs, immutable admitted schemas and exact signed-i64
handling. The conformance layer must not create a second runtime validator.
