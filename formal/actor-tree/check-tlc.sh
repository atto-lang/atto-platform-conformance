#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="2026.08.11.125311"
SHA256="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl --fail --location --retry 3 --silent --show-error \
  -o "$TMP/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-$VERSION/tla2tools.jar"
echo "$SHA256  $TMP/tla2tools.jar" | sha256sum --check --status
cd "$HERE"
java -Xmx1200m -cp "$TMP/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config TreePhysicalDone.cfg \
  -metadir "$TMP/safe" TreePhysicalDone.tla >"$TMP/safe.log" 2>&1 || {
    cat "$TMP/safe.log"; exit 1;
  }
grep -Eq 'Model checking completed|Model checking finished|Finished computing' \
  "$TMP/safe.log" || { cat "$TMP/safe.log"; exit 1; }
echo ACTOR_TREE_PHYSICAL_DONE_TLC_SAFE_PASS
check_mutant() {
  local config="$1" expected="$2" marker="$3" suffix="$4"
  if java -Xmx1200m -cp "$TMP/tla2tools.jar" tlc2.TLC \
      -workers 2 -deadlock -config "$config" \
      -metadir "$TMP/$suffix" TreePhysicalDone.tla >"$TMP/$suffix.log" 2>&1; then
    cat "$TMP/$suffix.log"; echo "mutant unexpectedly passed" >&2; exit 1
  fi
  grep -Eq "Invariant $expected is violated|$expected.*violated" \
    "$TMP/$suffix.log" || { cat "$TMP/$suffix.log"; exit 1; }
  echo "$marker"
}
check_mutant TreePhysicalDoneEarlyParentMutant.cfg NoEarlyParentDone \
  ACTOR_TREE_EXPECTED_EARLY_PARENT_COUNTEREXAMPLE early-parent
check_mutant TreePhysicalDoneStaleAdmitMutant.cfg NoPostStopGuestAdmission \
  ACTOR_TREE_EXPECTED_STALE_CALLBACK_COUNTEREXAMPLE stale-callback
