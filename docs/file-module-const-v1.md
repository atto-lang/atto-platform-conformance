# File/module static `define const` conformance v1

Specification: [atto-spec #88](https://github.com/atto-lang/atto-spec/pull/88).

Both `define const string x = os.read_env("KEY");` and `define const string x as os.read_env("KEY");` are **valid** at file/module scope. They execute **once at runtime initialization**, never during compilation, and bind an immutable `string`. The `os.read_env` accessor is **total, non-throwing and non-raising**: absent, empty-key, explicitly-empty and denied keys return `""`, with no secret disclosure. A separate strict API may report missing/denied keys if desired. Typed compile-time constants remain compile-time folded.

The registry has **19 cases**. `pass` must compile and execute guest code with the asserted result, including access-denied and missing variables; `fail` must reject at compile time with the expected diagnostic **and no executable artifact**. No `runtime-fail` cases remain for `os.read_env`.

The same guest executable artifact must run with `east` then `west` host environments and return 1 then 2; this rejects accidental build-time environment capture. The identical-key snapshot case must observe one read per key and immutable startup snapshot even if the underlying host environment is later changed. The denied-key case must return `""` even if a value is present in the host, and must never leak it. A host runtime must pass capability permissions explicitly to guest Wasm. No fallback to an unauthorized host process environment.

**All backend statuses remain NOT_EXECUTED.** Only real guest compilation/execution with exact-SHA provenance and env/capability/permission evidence may be marked PASS; syntax-only/host-only checks are insufficient.
