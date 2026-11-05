# AttoLang core/std source and compiler parity evidence v1

This is an **untrusted source-only contract** for the eight portable modules currently staged in `oreslang-common-source` draft #225. It pins the exact Git blob IDs from that canonical source candidate; it does not contain source contents, compile a guest, or authorize private source export.

The target backends are Java/GraalVM, LLVM, Wasm, Forge and .NET. Full hosted stdlib capability has **not** been established on all of them. The canonical `.atto` source blobs can be identical while compiler-admission, native execution, ownership and runtime semantics remain unsupported.

Use:

```sh
node bin/verify-atto-stdlib-evidence.mjs
node --test tests/atto-core-stdlib-evidence-v1.test.mjs
node bin/verify-atto-stdlib-evidence.mjs /path/to/untrusted-candidate.json
```

The source manifest is pinned a second time in the verifier, so changing both a manifest hash and a reported source hash does not silently alter v1. There must be exactly eight modules. A candidate receipt must contain 40 unique module/backend rows. `NOT_EXECUTED` rows must have zero steps, zero guest executions, zero negative compiler checks and null head/run identifiers. A row marked `EXECUTED_CANDIDATE` requires a 40-hex compiler head, a GitHub Actions run URL, at least two recorded steps, at least one compiled guest execution and at least one compiler-negative case. These are **shape requirements only**.

**Very important:** even a structurally accepted 40-row candidate emits `CANDIDATE_SCHEMA_ONLY_NOT_VERIFIED`. This verifier cannot authenticate GitHub-provided run/job steps, actual source-to-binary provenance, test executables, output correctness or signed approvals. Independent live exact-head evidence validation is mandatory before parity promotion. No zero-step workflow or source-only/selftest can be reported as a production compiler pass.

Private compiler code may not be exported to another organization merely because a repository is private or has available Actions minutes. The source-owner protected-main, review, allowlist, incident and immutable carrier identity gates must be verified first. Source-free test plans may run in a private carrier without private compiler source and do not satisfy guest execution requirements.

Upstream migration references: common-source #225, Java #2542/#2544 and LLVM #1425/#1428. These remain separate draft dependency stacks and do not imply any merge or runnable LLVM hosted stdlib.
