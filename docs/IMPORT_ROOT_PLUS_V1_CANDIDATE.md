# Candidate +/ project-root import admission v1

**Status: CANDIDATE / HOST REFERENCE ONLY / NOT_CERTIFIED**

The current [five-backend conformance issue #39](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/39) is about real source import graph/module discovery parity; this PR contributes a small, independently testable **source-path admission oracle**, not a backend compiler implementation or normative decision about the complete import language.

- `+/lib/telemetry.atto` is explicitly rooted at a project directory containing `.ores.pkg.toml`, not the current working directory or any `ORES_PATHS` entry.
- The candidate denies lexical traversal, empty components, noncanonical separators, missing/untrusted manifest, non-file source targets, and symlink escapes **after** physical realpath resolution. A symlink whose resolved target stays inside the project is permitted.
- The host reference demands explicit `.atto` or legacy `.ores` extensions to avoid guessing which source suffix should shadow the other. Source compiler parser/linker behavior is NOT established by this candidate.
- `ORES_PATHS` environment semantics, colon splitting, package aliases, import-cycle admission, symlink path caching, logical module IDs and the full compiler import graph require a separately reviewed backend-neutral contract. This oracle MUST NOT be treated as proof of any of those behaviors.
- The 17 versioned cases and negative controls are in `contracts/import-root-plus-v1/contract.json`; `tools/resolve-import-root-reference.mjs` is a pure host filesystem admission reference; `tests/import-root-plus-v1.test.mjs` uses temporary directories and symlinks, not compiler guest runs.
- All five backend statuses remain `NOT_EXECUTED`. To promote a backend, independently execute exact-head compiler/parser/guest fixtures, verify physical file identity against a trusted root, and record immutable source/tree/runner/job steps. A standalone reference test does not certify import parity.

**Security boundary:** This code reads only the local synthetic test tree. Do not copy any private Oreslang source to a public alternate-runner organization or change source-organization CI policy to run it.
