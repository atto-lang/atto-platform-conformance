# AttoLang source Unicode control admission v1

**Status:** source contract only; **zero backend execution receipts**. This is not a claim of Java, LLVM, Rust, Forge, Wasm, Cranelift, JS or .NET parity.

Source admission MUST reject the exact 15 Unicode codepoints in `contracts/source-unicode-control-v1.json`: bidirectional layout overrides/marks/isolates and visually deceptive Unicode line separators (U+0085, U+2028, U+2029). This check happens over original decoded text **before** comment stripping, tokenization, semantic lowering, optimizer passes or output publication. Rejection is required even when the character appears inside a comment or string. Otherwise a textual viewer and compiler may interpret differing line and token boundaries.

A conforming backend rejects the source, emits a deterministic source-position diagnostic, and produces **no runnable guest code**. Ordinary UTF-8 comments such as `/* café ☕ */` remain valid. The stage-0 Rust and Forge compilers are not required to support unrelated AttoLang language features to enforce this preflight rule. For every negative template, the verifier inserts the actual Unicode scalar value at runtime; the JSON file itself does not contain executable invisible controls.

The Node test here checks the **contract's completeness and evidence labeling only**. It does not launch a language compiler. Each backend must run compiler-backed positive and negative tests at a verified exact commit and tree, using approved runners, and retain independent execution receipts with correct source/blob mapping. No backend is promoted on source-only tests, zero-step workflows, billed-out Actions failures, or unapproved private-source transfers.
