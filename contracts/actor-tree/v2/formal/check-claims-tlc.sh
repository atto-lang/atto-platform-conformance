#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "$TLA2TOOLS_JAR"
cd "$HERE"
java -Xmx800m -cp "$TLA2TOOLS_JAR" tlc2.TLC \
  -workers 2 -deadlock -config PipelineClaim-safe.cfg PipelineClaim.tla \
  > /tmp/pipeline-claim-safe.log 2>&1 || {
    cat /tmp/pipeline-claim-safe.log; exit 1;
  }
grep -Eq 'Model checking completed|Model checking finished|Finished computing' \
  /tmp/pipeline-claim-safe.log || {
    cat /tmp/pipeline-claim-safe.log; exit 1;
  }
echo PIPELINE_CLAIM_TLC_SAFE_PASS
for model in replay quarantine; do
  log="$(mktemp)"
  if java -Xmx800m -cp "$TLA2TOOLS_JAR" tlc2.TLC \
    -workers 2 -deadlock -config "PipelineClaim-$model-mutant.cfg" \
    PipelineClaim.tla > "$log" 2>&1; then
    cat "$log"; rm -f "$log"
    echo "Unsafe claim $model mutant unexpectedly passed" >&2
    exit 1
  fi
  grep -Eq 'Invariant NoDoubleExternalEffect is violated|NoDoubleExternalEffect.*violated' "$log" || {
    cat "$log"; rm -f "$log"; exit 1;
  }
  echo "PIPELINE_CLAIM_EXPECTED_MUTANT:$model"
  rm -f "$log"
done
