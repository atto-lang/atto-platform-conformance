#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "$TLA2TOOLS_JAR"
cd "$HERE"
java -cp "$TLA2TOOLS_JAR" tlc2.TLC -workers 2 -deadlock \
  -config TypedRoundTrip-safe.cfg TypedRoundTrip.tla
for spec in schema-swap incarnation-reuse duplicate-delivery; do
  log="$(mktemp)"
  if java -cp "$TLA2TOOLS_JAR" tlc2.TLC -workers 2 -deadlock \
    -config "TypedRoundTrip-$spec.cfg" TypedRoundTrip.tla > "$log" 2>&1; then
    cat "$log"; rm -f "$log"
    echo "Expected $spec mutant to violate an invariant" >&2
    exit 1
  fi
  case "$spec" in
    schema-swap) invariant=NoSchemaSubstitution ;;
    incarnation-reuse) invariant=NoABAIncarnationReuse ;;
    duplicate-delivery) invariant=ExactlyOnceDelivery ;;
  esac
  grep -Eq "Invariant $invariant is violated|$invariant.*violated" "$log" || {
    cat "$log"; rm -f "$log"; exit 1;
  }
  rm -f "$log"
  echo "TYPED_ROUND_TRIP_EXPECTED_MUTANT:$spec"
done
echo TYPED_ROUND_TRIP_TLC_SAFE_PASS
