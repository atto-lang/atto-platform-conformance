# Source-only canonical core ledger (five backend candidates)

This offline validator does not query GitHub, execute a compiler, run an AttoLang guest, or validate a NativeAOT/Wasm/Cranelift binary. It binds the expected Git source blob identities for ores.core/numeric and ores.std/core but cannot prove that every backend has incorporated them into its production compiler. Those steps require independent execution receipts on exact heads.

Every backend is initially `NOT_EXECUTED`. Changing a status to a success claim is deliberately a hard error; a separate independently authenticated provenance verifier must be introduced to accept exact-head, run-attempt-bound, runner-assigned, nonzero-step compiler/guest evidence. No source-org minutes, private-source transfer permission, or alternate runner availability can be inferred from this manifest.

Offline checks: `python3 -I tests/verify_atto_core_source_ledger.py`, `python3 -I -m unittest discover -s tests -p 'test_atto_core_source_ledger.py' -v`. The negative matrix rejects duplicate JSON keys, forged execution claims, unexpected backend IDs, wrong hashes, invalid encoding, symlinks and oversized manifests.
