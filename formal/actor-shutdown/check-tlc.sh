#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="2026.08.11.125311"
SHA256="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
curl --fail --location --retry 3 --silent --show-error \
  -o "${TMP}/tla2tools.jar" \
  "https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
echo "${SHA256}  ${TMP}/tla2tools.jar" | sha256sum --check --status
cd "${HERE}"
java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config ActorShutdown.cfg \
  -metadir "${TMP}/safe" ActorShutdown.tla >"${TMP}/safe.log" 2>&1 || {
    cat "${TMP}/safe.log"; exit 1;
  }
if grep -Eq 'Invariant .* is violated|Error:|Error in specification' "${TMP}/safe.log"; then
  cat "${TMP}/safe.log"; exit 1
fi
grep -Eq 'Model checking completed|Model checking finished|Finished computing' "${TMP}/safe.log" || {
  cat "${TMP}/safe.log"; exit 1;
}
echo ACTOR_SHUTDOWN_TLC_SAFE_PASS
if java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
    -workers 2 -deadlock -config ActorShutdownUnsafe.cfg \
    -metadir "${TMP}/unsafe" ActorShutdown.tla >"${TMP}/unsafe.log" 2>&1; then
  cat "${TMP}/unsafe.log"
  echo "Expected mutant to violate NoPrematurePhysicalDone" >&2
  exit 1
fi
if ! grep -Eq 'Invariant NoPrematurePhysicalDone is violated|NoPrematurePhysicalDone.*violated' "${TMP}/unsafe.log"; then
  cat "${TMP}/unsafe.log"
  echo "Mutant failed for unrelated reason" >&2
  exit 1
fi
echo ACTOR_SHUTDOWN_EXPECTED_MUTANT_COUNTEREXAMPLE

java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config NativeReleaseWake.cfg \
  -metadir "${TMP}/native-safe" NativeReleaseWake.tla \
  >"${TMP}/native-safe.log" 2>&1 || {
    cat "${TMP}/native-safe.log"; exit 1;
  }
if grep -Eq 'Invariant .* is violated|Error:|Error in specification' "${TMP}/native-safe.log"; then
  cat "${TMP}/native-safe.log"; exit 1
fi
grep -Eq 'Model checking completed|Model checking finished|Finished computing' \
  "${TMP}/native-safe.log" || { cat "${TMP}/native-safe.log"; exit 1; }
echo NATIVE_RELEASE_WAKE_TLC_SAFE_PASS

if java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
    -workers 2 -deadlock -config NativeReleaseWakeUnsafe.cfg \
    -metadir "${TMP}/native-unsafe" NativeReleaseWake.tla \
    >"${TMP}/native-unsafe.log" 2>&1; then
  cat "${TMP}/native-unsafe.log"
  echo 'Expected native lost-wakeup mutant to violate NoLostWakeup' >&2
  exit 1
fi
if ! grep -Eq 'Invariant NoLostWakeup is violated|NoLostWakeup.*violated' \
  "${TMP}/native-unsafe.log"; then
  cat "${TMP}/native-unsafe.log"
  echo 'Native mutant failed for an unrelated reason' >&2
  exit 1
fi
echo NATIVE_RELEASE_WAKE_EXPECTED_MUTANT_COUNTEREXAMPLE
