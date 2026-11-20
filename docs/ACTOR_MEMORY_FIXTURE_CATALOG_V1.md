# Actor-memory executable conformance fixture catalog v1

This is a normative test manifest, not proof that any backend has executed these tests. Run all fixtures against compiled Oreslang guest programs on Java/GraalVM, LLVM, .NET Native AOT, wasm32, and JS Node/Worker (plus browser Worker where supported).

| ID | Fixture | Expected result |
| --- | --- | --- |
| MEM-001 | Two actors allocate and exchange typed immutable messages; retire one | Surviving actor's allocations remain valid |
| MEM-002 | Retire actor, recycle slot, dereference stale generation | Deterministic rejection; no use-after-free |
| MEM-003 | Forge actor-domain identity in opaque handle | Deterministic rejection |
| MEM-004 | Offset plus length overflows address width | Deterministic rejection |
| MEM-005 | Mutably borrow same field twice | Compile-time rejection |
| MEM-006 | Mutably borrow disjoint fields under proven disjointness | Compiles; no alias |
| MEM-007 | Retain invalid mutable borrow across await | Compile-time rejection |
| MEM-008 | Cancel pending continuation and terminate actor | Frames reclaimed only after quiescence |
| MEM-009 | Transfer ownership to full mailbox | Failed send preserves sender ownership |
| MEM-010 | Successful transfer | Sender invalidated, receiver exclusively owns payload |
| MEM-011 | Explicitly share deeply immutable graph | Readable from both actors, no mutation |
| MEM-012 | Attempt mutable cross-actor alias | Compile-time or checked runtime rejection |
| MEM-013 | Actor teardown races foreign callback | No reclamation before callback retires |
| MEM-014 | AoS/SoA/AoSoA/SoAoS round-trip | Identical values, preserved ordering semantics |
| MEM-015 | Swap-delete and reuse ECS entity slot | Old entity handle rejected |
| MEM-016 | Layout conversion with outstanding mutable view | Conversion rejected or safely deferred |
| MEM-017 | SoA disjoint column writes | Both writes valid without boxing requirement |
| MEM-018 | AoSoA tile tail | Masked lanes never read/write out of bounds |
| MEM-019 | SoAoS grouped nested fields | Group stride and alignment correct |
| MEM-020 | Repeat allocation and actor restart | Bounded retained guest memory under declared limits |

## Evidence schema
Each execution record MUST include: fixture ID, backend, platform, repository, full commit SHA, compiler command, guest execution command, exit code, stdout/stderr digest, CI workflow URL, job ID, runner ID/name (if available), executed step names and conclusions. Use statuses `PASS_EXECUTED`, `FAIL_EXECUTED`, `NOT_EXECUTED`, `UNOBSERVED`, `UNSUPPORTED`. `PASS_EXECUTED` requires real generated guest execution at exact head; a parser-only fixture, source-free canary, or zero-step workflow cannot qualify.

## Safe CI admission
Default to same-owner private CI. Never export source to another organization solely to obtain runner minutes. Any source-bearing destination requires a protected-main merged exact destination allowlist, independent security signoff, and verified visibility, permissions and retention. Keep security incident #22 unresolved until evidence supports closure.
