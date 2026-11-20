# P0 private-source carrier classification packet — incidents #171 and #172

**Snapshot date:** 2026-10-27 UTC  
**Status:** REVIEW ONLY / NON-AUTHORIZING.  
This packet records authenticated metadata and exact immutable identifiers for independent security disposition. It does not authorize private-source transfer, classify either placement as authorized/unauthorized by itself, or close either incident.

## Incident #171 — agent-pontifex private carrier

Carrier:
- repository: `agent-pontifex-test/agent-pontifex-e2e-tests`
- repository ID: `1370782550`
- current visibility: `private`
- archived: `false`
- default branch: `main`

Directly addressable source-bearing commit:
- commit: `2248a5d526820f91b8cd47e5f79ce4553e9bc1bb`
- tree: `d7b7cf651d6c7f73f49cebbfa546f878797419f0`
- recursive tree: complete (`truncated=false`), 70 entries

Authenticated tree metadata includes Oreslang source-bearing paths such as:
- `ci/code-image/src/main/java/dev/oreslang/compiler/OresCompiler.java`
- `ci/code-image/src/main/java/dev/oreslang/runtime/HotReloadManager.java`
- `ci/llvm-recovery/src/main/cpp/oreslang/runtime/ExceptionPolicy.hpp`
- `ci/recovery/src/main/java/dev/oreslang/runtime/RecoveryHandlerChain.java`

No workflow runs were returned for the exact carrier commit by the commit-run endpoint during this snapshot. That absence is not proof that the placement never executed through another ref/commit or that retained Git objects are purged.

Independent disposition required:
1. identify the exact originating source repository/commit/tree for every source-bearing file represented in the carrier tree;
2. determine whether valid contemporaneous destination + source-snapshot authorization existed before the writes;
3. classify the placement as authorized, unauthorized, mixed, or indeterminate with evidence;
4. decide preserve-for-forensics vs approved purge for the exact source-bearing Git objects/refs;
5. document GitHub/provider retention limits, audit-log review, credential/secret review, external-copy/fork/clone disposition;
6. record explicit closure/resume decision.

## Incident #172 — led-dynamo LLVM exact-tree carrier

Carrier:
- repository: `led-dynamo/leddy-e2e`
- repository ID: `1324139596`
- current visibility: `private`
- archived: `false`
- default branch: `main`

Executed source-bearing workflow evidence:
- workflow run: `40036080508`
- carrier head: `f6301ae7b7356a7fa9dbebffa64ed053ce77f3c7`
- branch: `validation/spin-prerequisites-20261023-final3`
- job: `120695763127` (`native-class-strings`)
- conclusion: `success`

The authenticated job log records:
- exact restored LLVM source commit: `fa35de07d6173f0eca03ee1d39d1f5bf66bad43c`
- exact restored LLVM source tree: `231f626eb66c4a4f97189d4021756fe6c89fe6c3`
- real CMake/C++ compilation of Oreslang LLVM sources;
- real CTest execution, including a 564-test suite;
- additional native parity execution.

This proves executed compiler/runtime testing for that exact restored LLVM source snapshot. It does **not** prove contemporaneous transfer authorization and does not certify a later/final PR head.

Retained artifact:
- artifact ID: `12537022948`
- name: `native-class-strings-20261023-evidence`
- size: 49,401 bytes
- digest: `sha256:8e54d29ff3174b6989d083b2a316a37ce6ea45aa6a95f0dcc634926fc977bbf8`
- current state: not expired
- expires: `2026-10-30T22:58:30Z`

Independent disposition required:
1. determine exact source origin and authorization state for LLVM commit/tree above;
2. classify the private-to-private placement under the policy in force at transfer time;
3. inspect the retained artifact before expiry and classify whether it contains source, logs, receipts, or derived-only evidence;
4. decide preserve vs purge for source-bearing refs/Git objects and the retained artifact;
5. document provider retention, audit-log, credential/secret, cache/log, fork/clone/external-copy disposition;
6. state whether any future mirroring may resume and under which protected-main, destination-specific policy;
7. record closure decision explicitly in incident #172.

## Shared release-gate rule

Neither incident may be treated as resolved because the carrier is private or because a workflow succeeded.

Private-source export remains blocked until:
- the incident receives explicit independent security disposition;
- source and destination protected-main requirements are live and verified;
- the exact destination is explicitly allowlisted by immutable repository ID;
- ownership, visibility, permissions and retention are verified;
- exact source-snapshot authorization is independently approved;
- executable CI evidence is tied to the exact authorized source SHA/tree.

**HOLD:** do not copy, mirror, publish, or execute new private Oreslang source in another organization based on this document.
