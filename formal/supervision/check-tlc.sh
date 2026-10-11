#!/usr/bin/env bash
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="2026.08.11.125311"
EXPECTED_SHA256="ab323b79802aedc3203b3f9af37c6aca3ed43f4e0225b36f2aa77b26de46c05f"
JAR_URL="https://github.com/zactionsz/tla-tools/releases/download/tla2tools-${VERSION}/tla2tools.jar"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
curl --fail --location --retry 3 --silent --show-error -o "${TMP}/tla2tools.jar" "${JAR_URL}"
echo "${EXPECTED_SHA256}  ${TMP}/tla2tools.jar" | sha256sum --check --status
cd "${HERE}"

echo "TLC safety model: two children, two turns, two incarnations"
java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorStop.cfg \
  -metadir "${TMP}/safety" SupervisorStop.tla \
  2>&1 | tee "${TMP}/safety.log"
if ! grep -Eq 'Model checking completed|Model checking finished|Finished computing' "${TMP}/safety.log"; then
  echo "TLC did not report completed checking" >&2
  exit 1
fi

echo "TLC mutation gate: deliberate replay MUST violate NoDoubleEffect"
if java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorStopMutant.cfg \
  -metadir "${TMP}/mutant" SupervisorStop.tla > "${TMP}/mutant.log" 2>&1; then
  cat "${TMP}/mutant.log"
  echo "Unsafe replay unexpectedly passed TLC!" >&2
  exit 1
fi
if ! grep -Eq 'Invariant NoDoubleEffect is violated|NoDoubleEffect.*violated' "${TMP}/mutant.log"; then
  cat "${TMP}/mutant.log"
  echo "Mutant failed for an unrelated reason instead of the expected invariant" >&2
  exit 1
fi
echo "EXPECTED_MUTANT_COUNTEREXAMPLE: NoDoubleEffect"
echo "SUPERVISOR_TLC_SAFETY_PASS"
