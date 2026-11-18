# File/module static `define const` conformance v1

Specification: [atto-spec #88](https://github.com/atto-lang/atto-spec/pull/88).

The `define const string x (=|as) os.read_env("KEY");` form is **valid** at file/module scope. It evaluates once at runtime initialization (never during build), under environment permissions, then becomes immutable. Pure constexpr remains compile-time folded. Top-level ordinary runtime calls still fail compilation.

The checked-in registry has **18 cases**: `pass` compiles and runs guest code; `fail` rejects at compile time and emits **no executable artifact**; `runtime-fail` compiles successfully, but startup errors *before main* when a required variable is missing or access is denied. The same executable artifact must be started twice with different environment values in `env_per_instance`, returning 1 then 2; this detects accidental compile-time environment capture. `env_same_key_snapshot` requires an immutable initial snapshot even if host environment changes after initialization and observes one host lookup per key.

The runner must allow setting a controlled environment for native AOT (or an explicit runtime env capability map for Wasm/browser), failing closed if no env provider exists. Never infer backend support from parser-only checks, static registry validation, successful code generation without guest execution, or source organization Actions runs that did not execute steps.

**All backends currently NOT_EXECUTED.** Each PASS needs exact compiler SHA/blob provenance, compilation, execution, permissions, errors and startup boundary evidence. No independent Java/LLVM/.NET/Wasm/Forge or browser guest evidence is claimed.
