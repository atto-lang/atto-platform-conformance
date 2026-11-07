# Merge-wave qualifier: strict civil timestamps

## Security finding

The offline qualifier used a timestamp shape check plus `Date.parse` for
`snapshot.as_of`, and `Date.parse` alone for `candidate.lease.expires_at`.
JavaScript accepts calendar-invalid values such as
`2026-02-30T18:00:00Z` by rolling them forward to March 2.
An agent-supplied snapshot or expiry could consequently be interpreted using a
calendar instant never supplied as a valid timestamp.

## Implemented fail-closed rule

Both timestamps must have an ISO-formatted real Gregorian calendar date,
including century leap-year handling, and valid 24-hour clock fields.
Second `60` (unsupported leap second), hour `24`, invalid offsets, year `0000`
and impossible days are rejected. Lease expiry allows a decimal fraction of
1–9 digits and explicit timezone offsets; `as_of` remains restricted by the
existing contract to `YYYY-MM-DDTHH:MM:SSZ` and the existing 5-minute *future*
limit. Inputs are checked before invoking `Date.parse`.

Dedicated regression suite:

```sh
node --test tests/merge-wave-qualifier-calendar.test.mjs
```

Full stacked suite (after parent #474 is present):

```sh
node --test \
  tests/merge-wave-qualifier.test.mjs \
  tests/merge-wave-qualifier-cli.test.mjs \
  tests/merge-wave-qualifier-e2e.test.mjs \
  tests/merge-wave-qualifier-calendar.test.mjs
```

## Boundaries and unresolved blockers

This fix **does not** authenticate the snapshot, provide a source-owned
CI receipt, establish an independent CODEOWNER approval, or permit a merge.
`as_of` has no enforced *past* freshness bound in this parent design; old
but real timestamps remain advisory and MUST undergo an authenticated live
GitHub recheck, including current leases. A future improvement should bind
freshness to the source-owned attestation, accounting for existing historical
unit fixtures. Private Actions runner admission and protected-main policy
remain independent blockers.

Keep parent #470/#474 and this stacked security child unmerged until actual
runner-backed execution, independent review, and the security holds are cleared.
No private source is transferred.
