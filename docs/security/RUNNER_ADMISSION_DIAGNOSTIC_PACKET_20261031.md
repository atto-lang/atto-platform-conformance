# Read-only GitHub Actions runner-admission diagnostic packet

**As-of:** 2026-10-31. **Status:** runner admission unverified; no production
runtime acceptance may be inferred. This packet contains only GitHub metadata
and administrator instructions. No private Oreslang source or secrets.

## Independent, exact-head evidence

| Repository / draft PR | Source head SHA | Workflow run | Job IDs checked | Result |
|---|---|---|---|---|
| `oreslang-platform-conformance` #263 | `e4b90e0b4b182287e33836ae55fc2b7bceb3f3dd` | `41234394623` | `124635014438` | 0 steps, no runner |
| `oreslang-source.java` #2305 | `b635d8bb6d3e486b77269bc5875c886cb2ed45e8` | `41230540723` | `124623657504`, `124623657750` | 0 steps, no runner |
| `oreslang-source.llvm` #1192 | `79d363e655813cb9edb9930212e3fdfbef445b58` | `41234110321` | `124634163120`, `124634163248`, `124634163359`, `124634163373`, `124634163380`, `124634163497` | 0 steps, no runner |

All observed jobs completed with a failure conclusion *without assigned runner
or executed steps*. This does **not** show a compiler, test, sanitizer or
security regression. It also does **not** establish that paid GitHub Actions
minutes are depleted.

A source-free private alternate-org retry, `honeypot-r-us-test/hnpt-infra`
run `41147809804` attempt 2, job `124625232510`, likewise completed
without any runner/steps. Historical successes in alternate organizations
do not prove current capacity or source-transfer authorization.

## Administrator diagnostic order (read-only)

1. Open the exact workflow run above while signed into an identity with
   organization Actions/billing administration. Capture the **run's original
   GitHub banner and failed check annotations**, without exposing secrets,
   invoice details or tokens. Zero-step log endpoints may return 404.
2. Confirm the source repository's Actions policy allows the relevant
   `ubuntu-24.04` GitHub-hosted runner; inspect runner groups, selected-repo
   restrictions, workflow permissions, private-repo entitlements, spending
   controls and account/org billing status. Determine the **actual reason**
   for failed admission from administrator evidence, rather than guessing.
3. Run the existing `source-local-runner-allocation-canary.yml`
   **without source checkout, secrets, uploads or Git-object export** in the
   source organization. Record run ID, attempt, exact SHA, assigned runner ID,
   step list and result.
4. On a trusted administrator workstation with a read-only GitHub token
   scoped to the original repository, this repository's
   `bin/diagnose-actions.mjs` can classify runs. Example (replace the run ID
   with the most recent run):

   ```bash
   node bin/diagnose-actions.mjs ores-truffle-oreslang/oreslang-platform-conformance 41234394623
   ```

   Nonzero exit is expected for non-executed jobs. The tool must not receive
   credentials via CLI arguments or echo raw API responses.
5. After a source-free canary executes **at least one meaningful step on a
   real assigned runner**, re-run the exact-head security Node suite for
   PR #263 and the Java/LLVM production integration jobs. Require a new
   immutable receipt for **each** source PR SHA and actual stepful evidence.
   Do not promote synthetic or source-class-only checks to full runtime
   acceptance.

## Transfer authorization remains separate

Open private-CI incidents #22, #77, #127, #171 and #172 have not received
independent dispositive review. The proposed PR #263 preflight denies
private Oreslang source publication, including self-mirroring, same-org
alternate repositories and cross-org relay handoffs, before any GitHub
API request. Source-free alternate-runner checks are allowed; copying any
private Git blob or full tree into an alternate carrier is **not** authorized
by this runbook, the test budget, or the user's request alone.

## Exit checklist

- [ ] Administrator recorded the specific GitHub admission error, not an inferred cause
- [ ] Source-free original-org canary has a real runner and meaningful executed step
- [ ] Security PR #263 `node --test` executes against its current exact head
- [ ] Java #2305 real native I/O + actor finalization JUnit executes on its exact head
- [ ] LLVM #1192 production CMake/CTest and sanitizer matrix execute on its exact head
- [ ] Private-source transfer remains blocked until independent incident disposition
