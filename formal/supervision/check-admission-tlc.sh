#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="2026.08.11.125311"
EXPECTED_SHA256="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl --fail --location --retry 3 --silent --show-error -o "$TMP/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
echo "$EXPECTED_SHA256  $TMP/tla2tools.jar" | sha256sum --check --status
cd "$HERE"
java -Xmx1200m -cp "$TMP/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorAdmissionLease.cfg \
  -metadir "$TMP/good" SupervisorAdmissionLease.tla > "$TMP/good.log" 2>&1
cat "$TMP/good.log"
grep -Eq 'Model checking completed|Model checking finished|Finished computing' "$TMP/good.log"
for pair in \
  SupervisorAdmissionLeaseUnsafePublish.cfg:NoUnleasedCommit \
  SupervisorAdmissionLeaseUnsafeStop.cfg:NoRetirementDuringLease; do
  cfg="${pair%%:*}"
  invariant="${pair##*:}"
  log="$TMP/$invariant.log"
  if java -Xmx1200m -cp "$TMP/tla2tools.jar" tlc2.TLC \
      -workers 2 -deadlock -config "$cfg" \
      -metadir "$TMP/mutant-$invariant" SupervisorAdmissionLease.tla \
      > "$log" 2>&1; then
    cat "$log"
    echo "Unsafe mutation unexpectedly passed: $invariant" >&2
    exit 1
  fi
  if ! grep -Eq "Invariant $invariant is violated|$invariant.*violated" "$log"; then
    cat "$log"
    echo "Mutant failed for the wrong reason: $invariant" >&2
    exit 1
  fi
  echo "EXPECTED_MUTANT_COUNTEREXAMPLE: $invariant"
done
echo "SUPERVISOR_ADMISSION_LEASE_TLC_PASS"
