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

echo "TLC mutation gates: each deliberately unsafe action must yield its own counterexample"
for pair in "SupervisorStopMutant.cfg:NoDoubleEffect" \
            "SupervisorStopRestartMutant.cfg:NoRestartUnderStop" \
            "SupervisorStopAckMutant.cfg:NoInvalidAck"; do
  cfg="${pair%%:*}"
  invariant="${pair##*:}"
  log="${TMP}/${invariant}.log"
  if java -Xmx1200m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
    -workers 2 -deadlock -config "${cfg}" \
    -metadir "${TMP}/mutant-${invariant}" SupervisorStop.tla > "${log}" 2>&1; then
    cat "${log}"
    echo "Unsafe mutation unexpectedly passed: ${invariant}" >&2
    exit 1
  fi
  if ! grep -Eq "Invariant ${invariant} is violated|${invariant}.*violated" "${log}"; then
    cat "${log}"
    echo "Mutation failed for an unrelated reason: ${invariant}" >&2
    exit 1
  fi
  echo "EXPECTED_MUTANT_COUNTEREXAMPLE: ${invariant}"
done
echo "TLC lifecycle model: CONTROL ownership, cleanup, STOP/RESTART"
java -Xmx1600m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 4 -deadlock -config SupervisorLifecycle.cfg \
  -metadir "${TMP}/lifecycle" SupervisorLifecycle.tla \
  2>&1 | tee "${TMP}/lifecycle.log"
if ! grep -Eq "Model checking completed|Model checking finished|Finished computing" "${TMP}/lifecycle.log"; then
  echo "TLC did not complete the lifecycle state graph" >&2
  exit 1
fi
echo "Lifecycle mutation must violate NoDuplicateEffects"
if java -Xmx1600m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 4 -deadlock -config SupervisorLifecycleMutant.cfg \
  -metadir "${TMP}/lifecycle-mutant" SupervisorLifecycle.tla > "${TMP}/lifecycle-mutant.log" 2>&1; then
  cat "${TMP}/lifecycle-mutant.log"
  echo "Unsafe lifecycle mutant unexpectedly passed" >&2
  exit 1
fi
if ! grep -Eq "Invariant NoDuplicateEffects is violated|NoDuplicateEffects.*violated" "${TMP}/lifecycle-mutant.log"; then
  cat "${TMP}/lifecycle-mutant.log"
  echo "Lifecycle mutant failed for unrelated reason" >&2
  exit 1
fi
echo "EXPECTED_MUTANT_COUNTEREXAMPLE: NoDuplicateEffects"
echo "Unsafe RESTART abort must violate the live-replacement ownership invariant"
if java -Xmx1600m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
  -workers 2 -deadlock -config SupervisorLifecycleUnsafeAbort.cfg \
  -metadir "${TMP}/lifecycle-unsafe-abort" SupervisorLifecycle.tla \
  > "${TMP}/lifecycle-unsafe-abort.log" 2>&1; then
  cat "${TMP}/lifecycle-unsafe-abort.log"
  echo "Unsafe live-replacement abort unexpectedly passed" >&2
  exit 1
fi
if ! grep -Eq 'Invariant NoOrphanReplacement is violated|NoOrphanReplacement.*violated' "${TMP}/lifecycle-unsafe-abort.log"; then
  cat "${TMP}/lifecycle-unsafe-abort.log"
  echo "Unsafe abort mutant failed for an unrelated reason" >&2
  exit 1
fi
echo "EXPECTED_MUTANT_COUNTEREXAMPLE: NoOrphanReplacement"
echo "Three-incarnation ABA-bound configurations"
for pair in "SupervisorStopABA.cfg:SupervisorStop" \
            "SupervisorLifecycleABA.cfg:SupervisorLifecycle"; do
  cfg="${pair%%:*}"
  module="${pair##*:}"
  log="${TMP}/${cfg}.log"
  java -Xmx1600m -cp "${TMP}/tla2tools.jar" tlc2.TLC \
    -workers 4 -deadlock -config "${cfg}" \
    -metadir "${TMP}/aba-${module}" "${module}.tla" 2>&1 | tee "${log}"
  if ! grep -Eq "Model checking completed|Model checking finished|Finished computing" "${log}"; then
    echo "Three-generation model failed: ${cfg}" >&2
    exit 1
  fi
done
echo "SUPERVISOR_TLC_SAFETY_PASS"
