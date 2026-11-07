# Root disjointness cannot be inferred from untrusted owner labels

**Candidate reference model only. NEVER an authorization or compiler soundness proof.**

## P0 model finding

Previously `placesOverlap(a,b)` returned `false` whenever `a.owner !== b.owner`. This silently treated two caller-chosen strings as a proof of separate storage. A lexical alias or a shared allocation may have distinct visible names but the **same underlying owner**. A source-only model cannot authenticate root identity on its own.

The reference model now conservatively returns **overlap=true** for differently labeled roots unless `layoutClaims.independentOwnerPairs` contains an exact normalized pair shaped as:
```json
{ "kind": "independent-roots", "owners": ["canonical_root_A", "canonical_root_B"] }
```
The pair must contain exactly two distinct valid canonical names; additional keys, wrong kinds, malformed lists, or unilateral matches have no effect. The modeled claim is **not a certificate**: the real compiler must separately establish stable canonical root identity, alias provenance, allocation domain and layout metadata in typed HIR/MIR before using any such separation to authorize disjoint loans or moves. No runtime borrow checking is introduced.

This fail-closed default prevents a free-form JSON owner label from implicitly weakening loan and move conflict checks. It also maintains prior, separately claimed nominal-field/array-element disjointness.

## Regression and mutation tests

The inherited 13-case model suite and 25-case matrix now explicitly distinguish *different names* from independently proven storage. New `tests/ownership-root-provenance-v1.test.mjs` adds **23 named source-only groups**: 18 malformed/missing/forged root claims and five legitimate/symmetry/alias-invalidation scenarios.

**81/81 source-only test groups passed in isolated V8** using synthetic SHA/clone/GitHub-API stand-ins (existing 58 + new 23). Four intentionally weakened model mutants were caught: allowing every distinct label, ignoring claim kind, accepting either root, and trusting unrecognized authority fields. These results do NOT include the one Node CLI subprocess test.

The exact-head, source-owned Node workflow now requires **82** groups total (10 receipt-shape, 13 CFG model, 10 mocked runner provenance, 1 CLI security subprocess, 25 ownership matrix, 23 root-provenance tests). GitHub Actions remains runner-admission blocked until nonzero steps execute.

**Merge gate:** independently reviewed exact-head source-owned tests; then compiler-generated root identities, five-backend source-to-MIR propagation, and independent guest/semantic receipt verification. Do not treat a claimed pair or `candidateAdmitted=true` as permission to merge/publish/transfer source.
