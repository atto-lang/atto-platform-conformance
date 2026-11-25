# AttoLang ownership typed-MIR place/CFG contract — candidate v1

**Status: source-only design/reference tests; NO compiler-backed guest proof, NO merge authority.**

This work is stacked on conformance PR #541. It does not modify the canonical AttoLang grammar, does not add runtime borrow tables and does not authorize any source transfer to an external GitHub organization.

## Place identity and disjointness

A `Place` is a compiler-canonical owner identity and a bounded projection path. Projections support named fields and static/dynamic indices. No public source-level pointer operators are introduced.

The model uses `{owner, path}` rather than raw variable spelling. Distinct owner IDs can be treated as disjoint **only after** each compiler proves that they are distinct underlying storage/provenance roots; this JavaScript reference cannot prove that identity. Same-owner projections overlap by default.

Siblings become independent only when the frontend provides a layout claim naming the exact owner, parent, and nominal fields or independently addressable array elements. Layout claims are **not certificates**: a compiler cannot enable disjoint mutable borrows solely by accepting unverified JSON. Required future proof: typed layout definition, alias/union exclusion, exact projected storage representation, canonical ownership origin and matching backend lowering.

## CFG event semantics

The executable *candidate* model `src/ownership-place-cfg-v1.mjs`:
- Tracks explicit shared/exclusive loans and rejects overlapping exclusive loans, moves and writes.
- Rejects reads and takes of possibly moved places.
- Allows field-slot restoration only for the exact moved slot, and whole-owner restoration through explicit rebind.
- At a join, conservatively unions moves from **either** predecessor, and rejects incompatible outstanding loan inventories. It does not silently turn a maybe-moved owner into live storage.
- Rejects live loans across `suspend`, borrowed actor/task transport, unknown transport provenance, unbalanced releases and loans escaping the modeled lexical scope.
- An `owned-take` actor send **consumes and invalidates** its canonical source place; later reads and repeat sends reject. An `owned-copy` send requires an unmoved place and rejects a conflicting exclusive loan. Neither `payloadMode` nor a layout claim independently proves Copy, Send, tenant authority, or a valid generation fence.
- Enforces bounded input depth and operation count; unsupported path/event kinds fail closed.

A successful model evaluation is `CANDIDATE_ACCEPTED_UNATTESTED`, with `ok=false`, `verified=false`. It does **not** prove sound nonlexical lifetimes, task cancellation, actor isolation, Send/Sync/Share rights, tenant generation fencing, or actual MIR lowering. Runtime and source-checker implementations must prove and exercise all such obligations separately.

`tests/ownership-place-cfg-v1.test.mjs`: 13 source-only groups covering positive/negative paths, adversarial mutation conditions, CFG joins, loan release, partial moves and suspension boundaries.

## Independent GitHub runner metadata (not checkout/guest proof)

`src/ownership-runner-provenance-v1.mjs` performs a read-only, fresh GitHub API check for one **independently selected** source repository, immutable expected head, run ID/attempt and job ID:

1. Git commit endpoint confirms the expected commit and its Git tree object.
2. The run-attempt endpoint confirms the same immutable head, attempt number, success, and matching repository if supplied.
3. The attempt-specific job-list endpoint confirms the exact job, assigned runner, nonempty uniquely named steps and successful required executed steps.
4. Missing/ambiguous jobs, zero steps, wrong attempts, synthetic merge heads, skipped/failed steps, malformed inputs and unavailable GitHub API data fail closed.

The GitHub commit's tree being resolved **does not** establish which tree a runner checked out. Hence `sourceCommitTreeResolved=true` may be returned, but `checkoutVerified=false`, `guestExecutionVerified=false`, `verified=false`, and `ok=false` ALWAYS remain. The only positive result is `runnerExecutionVerified=true` and `RUNNER_EXECUTION_VERIFIED_GUEST_UNVERIFIED`.

A future, separately reviewed verifier must independently examine exact checkout logs, source/test blobs, compiler identity/arguments, native guest artifacts and diagnostic stage before claiming backend conformance. The query reader must be authenticated to GitHub under **the source organization**, with read-only API access. No bearer token may be emitted in logs or uploaded in artifacts.

A source-org owner can invoke the after-the-fact **runner-only** CLI from an authorized checkout (using a preexisting environment token rather than printing credentials):

```sh
node bin/verify-ownership-runner-v1.mjs \
  --repo ores-truffle-oreslang/oreslang-source.java \
  --head FULL_40_CHAR_IMMUTABLE_SHA \
  --run GITHUB_RUN_ID --attempt GITHUB_RUN_ATTEMPT --job GITHUB_JOB_ID \
  --required-step 'Checkout exact source commit' \
  --required-step 'Execute real ownership and primitive-copy JUnit tests'
```

The CLI deliberately refuses repositories outside `ores-truffle-oreslang`. Exit code 0 means **only** that the API independently confirmed an assigned runner and matching successfully executed required steps. Its JSON still returns `ok:false`, `verified:false`, `checkoutVerified:false` and `guestExecutionVerified:false`. It cannot validate private repository billing, check annotations, or compiler/guest semantics. An exit code 1 or 2 is not evidence of guest-test failure.

`tests/ownership-runner-provenance-v1.test.mjs`: 10 source-only mocked-API groups; these are not a live source-org runner execution result.

## CI admission finding and administrator action

Current source-owned Actions jobs for Java #2607, LLVM #1494 and conformance #541 failed with `steps=null`; their logs are unavailable (404 BlobNotFound). The precise GitHub runner-admission rejection reason **is not established** by the linked integration. Existing escalation issues are:
- [Java #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963)
- [LLVM #159](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/159)
- [Conformance #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315)

An authorized organization administrator must inspect Actions annotations, private-repo billing/budgets/eligibility, hosted-runner settings and policies, and capture the **actual** denial. After remediation, run a source-local checkout-free source-free canary, then exact-head Java/GraalVM and LLVM compiler/guest tests. Do **not** infer a billing cause from zero-step status, transfer private source across organizations, or promote isolated host tests as compiler proof.

## Implementation sequence for backend owners

1. Java: generate canonical `Place` IDs and typed per-projection metadata in HIR/MIR, attach direct loan provenance, and make CFG joins retain maybe-moved projections; preserve existing conservative checker until new proof is end-to-end.
2. LLVM: carry the same `Place`/loan/provenance identities through typed HIR and backend lowering; maintain current fail-closed direct-place admission until invalidation, cleanup and actor transfer are proven.
3. Conformance: serialize identical positive and negative `.atto` programs, run each real frontend, distinguish parser vs semantic ownership rejection, and independently validate emitted or absent guest artifacts.
4. .NET NativeAOT, Wasm and Forge: implement the same typed contract and real compiler/guest evidence, not a source-free host model.
5. Merge only after exact-head nonzero-step test receipts and independent review. `steps=[]` and `steps=null` remain `RUNNER_ADMISSION / NOT_EXECUTED`.

The exact-head source-only workflow now requires **34** Node test groups: 10 receipt-shape, 13 CFG model, 10 runner-provenance mocked-API and 1 CLI fail-closed/security group. These are explicit **NON-PROMOTING** test classes.
