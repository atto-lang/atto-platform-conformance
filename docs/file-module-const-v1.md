# File/module constant conformance v1

Target behavior: [atto-spec/language/file-module-const-v1.md](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md) (the source proposal may still be an open PR).

This registry has nine portable compiler/guest cases. Positive cases require actual executable return-value assertions; negative cases require the expected diagnostic **and no artifact**. The two declaration separators are semantically identical. An OS environment lookup is never a compile-time `const`.

Current status: **NOT_EXECUTED on all backends**. No parser-only or host validator result is equivalent to compiled guest evidence. A runner must pin its compiler and fixture Git blob/tree SHAs and identify the backend/toolchain before publishing a PASS.
