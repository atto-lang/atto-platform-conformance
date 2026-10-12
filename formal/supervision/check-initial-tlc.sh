#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="2026.08.11.125311"
EXPECTED_SHA256="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
curl --fail --location --retry 3 --silent --show-error -o "$TEMP/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
echo "$EXPECTED_SHA256  $TEMP/tla2tools.jar" | sha256sum --check --status
cd "$HERE"
java -Xmx1600m -cp "$TEMP/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorInitialAdmission.cfg \
  -metadir "$TEMP/positive" SupervisorInitialAdmission.tla \
  > "$TEMP/positive.log" 2>&1
cat "$TEMP/positive.log"
grep -Eq 'Model checking completed|Model checking finished|Finished computing' "$TEMP/positive.log"
for pair in \
    SupervisorInitialAdmissionUnleased.cfg:RegistrationProofCoherent \
    SupervisorInitialAdmissionStopMutant.cfg:NoStopWhileLeased \
    SupervisorInitialAdmissionABAMutant.cfg:NoStaleRegistration; do
  cfg="${pair%%:*}"
  invariant="${pair##*:}"
  log="$TEMP/${invariant}.log"
  if java -Xmx1600m -cp "$TEMP/tla2tools.jar" tlc2.TLC \
      -workers 2 -deadlock -config "$cfg" \
      -metadir "$TEMP/mutant-$invariant" SupervisorInitialAdmission.tla \
      > "$log" 2>&1; then
    cat "$log"
    echo "Unsafe initial registration mutant unexpectedly passed: $invariant" >&2
    exit 1
  fi
  if ! grep -Eq "Invariant $invariant is violated|$invariant.*violated" "$log"; then
    cat "$log"
    echo "Initial registration mutation did not find the intended counterexample" >&2
    exit 1
  fi
  echo "EXPECTED_MUTANT_COUNTEREXAMPLE: $invariant"
done
echo "SUPERVISOR_INITIAL_REGISTRATION_TLC_PASS"
