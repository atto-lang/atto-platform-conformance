# Import parity v1 — shared source graph

This is a **source corpus**, not proof of backend compilation, execution or five-backend parity. The `cases.json` ledger deliberately starts at `CORPUS_ONLY_NOT_BACKEND_EXECUTION` with no execution evidence.

A single package manifest anchors `+/src/lib/helper`. Two separate entrypoints call the same helper with argument 41: one uses `+/`, the other `./`. The expected result is 42. A third fixture uses an in-root `..` traversal spelling and **must be rejected even though filesystem normalization could yield an in-package target**.

For a backend to claim success, run each case with its real, exact-revision compiler and check the compiled result, not a regex or synthetic stub. Preserve separate provenance (compiler source/tree SHA, runner, toolchain, raw stdout/stderr, invocation, exit status, artifact hashes). For .NET, Forge and Wasm, current expected implementation status is reject-only; positive support must not be inferred from source admission tests.

This corpus is intentionally independent and does not copy private compiler code into another repository. Any private source checkout or cross-organization mirror still requires the owning repository's explicit approval controls.

Two more cases preserve **literal CR-only line endings** in the Git blobs. In
`main-cr-comment.ores`, a leading `//` comment must terminate at CR so
`import fnc helper from "./lib/helper";` remains visible and the linked
program returns 42. In `invalid-cr-root-traversal.ores`, the same boundary
exposes the noncanonical `+/src/../src/lib/helper` import, which must reject
rather than silently compile an incomplete graph. These are corpus **fixtures**;
running the Node integrity checks alone does not establish any backend compiler
behavior or CI capacity. Preserve CR bytes when loading and exercising them.

## Corpus-byte integrity gate

Every source entry in `cases.json` now records its exact Git blob SHA-1;
`supportBlobs` similarly pins the package manifest and shared helper. The
Node test independently pins those values, checks complete inventory coverage,
and hashes the actual raw bytes using Git's `blob <byte-count>\\0` object
format. The reader fails closed for symlinks in fixture path components,
non-regular source files, noncanonical paths, files over 1 MiB, malformed
UTF-8, and detected read-time mutation. The checks are **not** a race-free
filesystem confinement primitive and do not authorize cross-organization
private source publication.

A local reconstruction matched GitHub Git blob hashes for all nine fixture
and test files (including this corpus's `cases.json` and executable Node test),
then passed all six Node 22 tests. The source-organization hosted Actions
job still has zero executed steps and cannot certify this branch. These
checks are source-only; functional compiler parity is still unverified.


## Source-free physical-containment reference matrix

`tests/import-v1-physical-containment-sourcefree.test.mjs` records a filesystem
policy invariant shared by backends that eventually admit multi-file source
imports. It is deliberately **not** compiler execution evidence:

- an explicitly configured search root may itself be a symlink when the
  resolved source remains inside that root's physical target;
- an in-root file alias canonicalizes to one physical source identity;
- a child file symlink that escapes the physical root is rejected;
- a child directory symlink that escapes the physical root is rejected;
- a dangling higher-priority leaf or broken intermediate alias rejects instead
  of falling through to a lower ambient root;
- an existing higher-priority non-directory prefix rejects instead of falling
  through;
- an explicitly configured root that exists but is not a directory rejects.

The reference test uses temporary real filesystem symlinks and canonical paths,
but it is source-free and contains no private backend implementation. A backend
may claim this invariant only after its own exact-revision compiler/resolver
executes equivalent positive and negative cases.

Current implementation audit status is intentionally separate from parity:
LLVM and .NET contain backend-specific physical/symlink escape regressions;
Java has current-main candidate hardening in PR #2147; Wasm and Forge still
fail closed on unsupported source-import graphs and therefore do not gain a
positive multi-file-import claim from this reference matrix.


## Source-free explicit-filesystem import reference

`tests/import-v1-explicit-filesystem-sourcefree.test.mjs` adds a second
source-free reference matrix for explicit filesystem imports. It is policy
evidence only, not compiler execution proof.

The matrix preserves the intentional compatibility boundary while hardening
physical source identity:

- manifest-backed relative imports remain inside the physical project root;
- relative file and directory symlink escapes reject;
- lexical project authority is preserved for a project-local symlink entry even
  when the entry's physical target is outside the project;
- a symlinked importer is resolved by physical identity, so it cannot launder
  an outside sibling back into the project;
- nested package markers reject relative cross-package imports, including when
  the nested directory is reached through an in-root symlink alias;
- malformed and dangling nested markers still claim a package boundary by
  existence rather than becoming a fail-open parse/missing condition;
- in-root aliases canonicalize to one physical source identity;
- absolute imports remain explicitly supported and canonicalize their target;
- no-manifest `../` relative imports remain supported;
- dangling explicit aliases fail closed;
- only `.`, `..`, `./...`, and `../...` are explicit-relative spellings;
  dot-prefixed bare names such as `.hidden/util` and `..backup/util` remain
  in configured bare-root/package resolution.

The current Java implementation stack uses the legacy
`.oreslangc.cfg.toml` marker for this narrow compatibility slice. Migration to
the language-level `.ores.pkg.toml` package contract is a separate parity
gate and must not be inferred from this source-free matrix.


## Source-free no-follow source snapshot reference

`tests/import-v1-source-snapshot-sourcefree.test.mjs` records the byte-admission
invariant after a filesystem path has been resolved:

- a caller-facing symlink spelling may canonicalize once to a physical source;
- the physical snapshot path itself may not contain a symlink leaf or parent;
- the opened object must be a bounded regular file;
- the snapshot rejects growth/truncation or observed file-identity/metadata
  change while bytes are being captured.

This matrix is source-free policy evidence, not proof that a backend implements
an atomic open-by-inode primitive. Java PR #2147 now uses no-follow opens and
descriptor-relative traversal when the filesystem exposes
`SecureDirectoryStream`; its portable fallback performs no-follow component
checks before and after the bounded read. The Wasm compiler bridge already uses
no-follow descriptor snapshots with before/after inode metadata. Backend claims
still require exact-revision execution in that backend.


## Source-free modern package-root reference

`tests/import-v1-package-root-sourcefree.test.mjs` records the package-root
authority contract separately from compiler execution:

- `.ores.pkg.toml` is the canonical modern package marker;
- a modern marker wins over a same-directory legacy
  `.oreslangc.cfg.toml` marker by marker existence and malformed modern
  markers fail closed;
- the modern package root is the physical directory containing
  `.ores.pkg.toml`; it is not redirected by legacy-style
  `[project].root`;
- canonical root imports use `+path`, for example
  `+lib/telemetry`; the older draft `+/path` spelling is rejected;
- root-import paths reject traversal, empty components, backslashes,
  drive/colon spellings, and control bytes;
- root-import targets remain physically contained in the owning package and
  cannot cross nested modern or legacy package markers;
- root authority is scoped to the importing source's **nearest** package
  marker. An external package therefore gets its own `+` root, while a
  nearer legacy package or malformed modern marker blocks inheritance from a
  parent package;
- modern-manifest `source.roots`, `source.import_paths`, and
  `entrypoints.main` remain inside the physical package root, including
  when missing descendants sit below symlinked existing ancestors;
- `ORES_PATHS` is colon-delimited, empty entries grant no current-directory
  authority, and its roots precede the legacy host-delimited
  `ORESLANG_PATH` fallback.

Legacy `.oreslangc.cfg.toml` behavior remains a migration compatibility
surface. In particular, this package-root reference does not retroactively
apply modern marker/no-follow semantics to legacy manifests.

As with the other source-free import-v1 models, this is policy evidence only.
A backend may claim package-root support only after its exact compiler/runtime
revision executes equivalent positive and negative cases.
