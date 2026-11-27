# Canonical stdout v1

Both `stdio.out.write(...)` and `process.stdout.write(...)` are canonical. This candidate corpus exercises the same raw string output without implied newlines, mixed spellings in LIFO cleanup and checked inline task failure. It does not prescribe new overloads or introduce unrestricted host access. Existing capability and isolation gates must remain.

Historical checked-unwrap v6 fixtures and their pins are unchanged. Backends must compile these exact bytes, execute real guest artifacts and compare raw stdout bytes and result; unsupported profiles stay gaps. Receipts must bind compiler head/tree, compiler artifact, fixture blob, execution target and actual result. Manifest verification alone proves source integrity, not guest execution. HDL/realtime need explicitly documented execution profiles; no simulated pass.
