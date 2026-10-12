#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION="2026.08.11.125311"
SHA="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
curl --fail --location --retry 3 --silent --show-error -o "$TMP/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
echo "$SHA  $TMP/tla2tools.jar" | sha256sum --check --status
cd "$HERE"
if ! java -Xmx1600m -cp "$TMP/tla2tools.jar" tlc2.TLC \
   -workers 2 -deadlock -config NativeParentPanicAuthority.cfg \
   -metadir "$TMP/positive" NativeParentPanicAuthority.tla \
   > "$TMP/positive.log" 2>&1; then
  cat "$TMP/positive.log"
  exit 1
fi
cat "$TMP/positive.log"
grep -q 'Model checking completed. No error has been found.' "$TMP/positive.log"
for pair in \
  NativeParentPanicAuthorityLegacyMutant.cfg:NoLegacyConsumption \
  NativeParentPanicAuthorityStoppedMutant.cfg:NoStoppedConsumption \
  NativeParentPanicAuthorityReusedMutant.cfg:NoWrongGenerationConsumption \
  NativeParentPanicAuthorityReplayMutant.cfg:NoDuplicateConsumption; do
  cfg="${pair%%:*}"
  invariant="${pair##*:}"
  if java -Xmx1600m -cp "$TMP/tla2tools.jar" tlc2.TLC \
      -workers 2 -deadlock -config "$cfg" \
      -metadir "$TMP/mutant-$invariant" NativeParentPanicAuthority.tla \
      > "$TMP/$invariant.log" 2>&1; then
    cat "$TMP/$invariant.log"
    echo "Unsafe parent PANIC mutant unexpectedly passed: $invariant" >&2
    exit 1
  fi
  if ! grep -Eq "Invariant $invariant is violated|$invariant.*violated" "$TMP/$invariant.log"; then
    cat "$TMP/$invariant.log"
    echo "PANIC mutant did not produce target counterexample: $invariant" >&2
    exit 1
  fi
  echo "EXPECTED_PARENT_PANIC_COUNTEREXAMPLE: $invariant"
done
echo "NATIVE_PARENT_PANIC_TLC_PASS"
