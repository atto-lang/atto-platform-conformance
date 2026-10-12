#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION="2026.08.11.125311"
SHA="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
curl --fail --location --retry 3 --silent --show-error -o "$TMP/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
echo "$SHA  $TMP/tla2tools.jar" | sha256sum --check --status
cd "$ROOT"
java -Xmx1600m -cp "$TMP/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorRecycledCandidate.cfg \
  -metadir "$TMP/positive" SupervisorRecycledCandidate.tla > "$TMP/positive.log" 2>&1
cat "$TMP/positive.log"
grep -q 'Model checking completed. No error has been found.' "$TMP/positive.log"
for pair in \
  SupervisorRecycledCandidateEarlyMutant.cfg:NoUncleanRecycling \
  SupervisorRecycledCandidateStaleMutant.cfg:NoStaleGenerationDelivery \
  SupervisorRecycledCandidateIndexMutant.cfg:NoLegacySlotAlias; do
  cfg="${pair%%:*}"
  invariant="${pair##*:}"
  log="$TMP/$invariant.log"
  if java -Xmx1600m -cp "$TMP/tla2tools.jar" tlc2.TLC \
      -workers 2 -deadlock -config "$cfg" \
      -metadir "$TMP/mutant-$invariant" SupervisorRecycledCandidate.tla \
      > "$log" 2>&1; then
    cat "$log"
    echo "Unsafe mutation unexpectedly passed: $invariant" >&2
    exit 1
  fi
  if ! grep -Eq "Invariant $invariant is violated|$invariant.*violated" "$log"; then
    cat "$log"
    echo "Mutant did not violate its intended invariant: $invariant" >&2
    exit 1
  fi
  echo "EXPECTED_RECYCLE_MUTANT_COUNTEREXAMPLE: $invariant"
done
echo "NATIVE_RECYCLED_CANDIDATE_TLC_PASS"
