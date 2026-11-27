# Value-loop/recur shared acceptance targets

Pinned from [Rust draft #724](https://github.com/atto-lang/atto-source.rs/pull/724), exact source 05d1cf6841f2f91b1678c8e0c296dc476f5e3789. This is an inventory/target contract, not an executed backend certification. 24 historical source blobs plus 4 new positive targets. Run `node --test tests/value-loop-recur-targets.test.mjs` for source integrity only.

Each backend must compile these exact bytes with its real frontend, execute positive guests and compare the full signed 64-bit result plus exact stdout; process exit status alone is insufficient. Each negative needs an explicit semantic diagnostic mapping and no published executable artifact. No source translation, host oracle substitution, or unsupported-as-pass. Preserve independent compiler identity (Rust browser/native-host compiler counts as one family). HDL and hard-real-time target profiles must record explicit scope/rejection, not silently claim support.

Follow spec #291 and conformance #230. The stateless and nested value-loop targets are new, not historical verified behavior. Failure-before-commit, cleanup, owned carried state, and scheduling/cancellation still require new separately executed guests.
