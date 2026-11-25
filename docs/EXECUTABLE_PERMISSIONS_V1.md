# Oreslang executable permission manifest v1 — draft contract

This is a format/decision reference, **not** native enforcement or an OS sandbox. See src/permission-manifest.mjs for the verifier and tests/permission-manifest.test.mjs for negative tests.

## Artifact and authority boundaries

The compiler can read source/packages in its separate **trusted toolchain I/O domain**. That never becomes a guest permission. Build flags determine an artifact's **maximum guest authority ceiling**, not a runtime self-grant. Runtime requests may only attenuate that ceiling.

The trusted packaging pipeline must compute SHA-256 of the final executable payload *excluding the manifest*, and the trusted loader must obtain its expected digest through an independent protected or signed channel. The manifest records this artifact digest and rejects mismatched pairings. **A hash is not a signature**: controlling both the binary and its supposed expected hash defeats this check.

For every privileged operation, require all five independent policies: host/OS ceiling, artifact ceiling, runtime request, actor/isolate, delegated child. Deny overrides allow in any layer; missing policy is an error. Never intersect raw scope strings as if they were resolved resources. **Validate and snapshot all five authority layers before invoking any resource-matching callback or asynchronous/native operation.** A reentrant matcher or child callback must not mutate the effective permission decision mid-check; malformed later layers must reject even if an earlier layer would deny. Implementations may instead use trusted immutable versioned policy snapshots. Match each unique scope against the same normalized resource identity **once per authorization decision**, and evaluate every explicit deny before any positive grant. Reusing a scope matcher with mutable DNS or filesystem state across deny and allow checks can otherwise create contradictory decisions. This per-decision cache is not a substitute for binding actual I/O to an authorized descriptor, resolved destination IP, or OS sandbox; recheck each new operation and redirect at its trusted I/O boundary.

## Canonical JSON v1

Root keys, in order: format, version, artifact_sha256, policy. Format is oreslang.permissions; version is integer 1. Artifact digest is 64 lowercase hex characters. Policy has exactly eight categories in this order: read, write, net, env, run, sys, ffi, import. Each has allow and deny string arrays; an empty allow grants nothing. An asterisk means all resources in *that category*. Arrays are sorted and unique, at most 128 entries, each scope <=4096 UTF-8 bytes. Maximum total manifest is 65,536 bytes.

Serialization is minified UTF-8 JSON without trailing newline. Reject missing, duplicate or unknown fields, invalid scopes, corrupted or noncanonical JSON, downgrades, and artifact digest mismatch. Reject unpaired UTF-16 surrogate code units before any UTF-8 conversion, since host runtimes can otherwise substitute U+FFFD and alter a permission scope's identity. The verifier returns a deeply frozen permission-policy snapshot (categories, rules and scope arrays); do not subsequently mutate a verified authority ceiling. Targets must additionally validate semantic scope grammar before any runtime policy operation. A missing manifest on a permission-managed executable means reject execution, not inherit OS/isolate grants. A user-editable sidecar or environment variable is not a trusted ceiling.

## Native enforcement requirements

- Filesystem READ/WRITE/IMPORT/FFI: compare actual canonical target and perform descriptor-relative operations to prevent symlink swap and TOCTOU escapes.
- NET: normalize host, port and IP forms; verify actual destination addresses and every redirect; protect against DNS rebinding and alias bypass.
- ENV/SYS/RUN: validate exact key/process/argv/env rules and inherited file descriptors/handles; subprocesses cannot acquire parent-forbidden authority.
- Actors, ActorGroups, untrusted JIT, dynamic imports and hot reload cannot mint grants. Raw FFI/syscalls require actual OS sandboxing or strictly mediated trusted host APIs. Unsupported target permissions reject rather than silently ignore.

The reference decision helper deliberately relies on a trusted caller-supplied resource matcher, demands a boolean result rather than truthiness, and **cannot itself enforce host I/O**. The repository includes deterministic authority-lattice, digest, malformed-Unicode, mutation, serialization and budget tests; these are reference tests only, not native-runtime evidence.

## CLI parser and evidence gates

The canonical CLI flags/args parser is github.com/flags-2-env. No independent fallback parser is allowed. Both compiler and compiled executable must validate Deno-style allow/deny options, allow-all, no-prompt, permission-check modes, unknown/duplicate flags, and positional double-dash boundaries. Ambient environment variables and project env files never become guest grants. Java source PR #938, LLVM PR #376, and CLI issue #8 track migration.

Before declaring parity, run exact-head Java/GraalVM and LLVM compiled executables with positive/negative manifest, network, filesystem, actor, subprocess and FFI fixtures. Record the executing runner and steps; zero-step CI failures are inconclusive. Do not mirror private source into any test repository without an exact destination on the protected reviewed allowlist.

**Current status:** reference Node verifier and focused unit tests, not wired to Java/LLVM emitted executables.
