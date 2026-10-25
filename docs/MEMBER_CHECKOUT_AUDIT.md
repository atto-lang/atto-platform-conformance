# Auditing local member checkouts

For an already downloaded set of `ores-truffle-oreslang` repositories:

```sh
node bin/audit-member-checkouts.mjs /absolute/path/to/sibling-checkouts --allow-missing
```

It reads *only local files* and the checked-out Git object IDs; no remote repository checkout, credential transmission, or workflow token is required. It validates each present member `.oreslang/integration.json` against the registry; rejects symlinked checkouts, malformed or oversized manifests, dirty working trees, uncommitted files and non-root Git directories; and records each Git commit/tree SHA. Omit `--allow-missing` to fail if **any** of the 52 repository directories is absent, including the intentionally uninitialized repositories.

The emitted JSON has `evidence: "metadata-only"`. Even a clean checkout and matching SHA **do not establish source compatibility, runtime behavior, actor fault isolation, performance, target admission or CI parity**. Use a separate pin-aware source build and executable conformance receipt before promoting integration edges. Git SHA values are Git identity references, not signatures or proof of trusted authorship.
