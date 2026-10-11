#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then echo "usage: llvm-value-runner.sh fixture.ores" >&2; exit 2; fi
: "${ORES_LLVM_COMPILER:?ORES_LLVM_COMPILER must be an absolute pinned binary}"
: "${ORES_CLANG:?ORES_CLANG must be an absolute pinned binary}"
: "${ORES_CONFORMANCE_ROOT:?ORES_CONFORMANCE_ROOT must be the pinned conformance source}"
test -x "$ORES_LLVM_COMPILER"
test -x "$ORES_CLANG"
test -f "$1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
"$ORES_LLVM_COMPILER" "$1" > "$tmp/guest.ll"
# Change the guest entrypoint symbol, so the C probe can print full signed i64.
# Must match a definition or declaration, not just a comment.
grep -Eq '(^define |^declare ).*@main\\(' "$tmp/guest.ll" || { echo "no emitted native main" >&2; exit 3; }
sed 's/@main(/@oreslang_guest_main(/g' "$tmp/guest.ll" > "$tmp/renamed.ll"
"$ORES_CLANG" -x ir -c "$tmp/renamed.ll" -o "$tmp/guest.o"
"$ORES_CLANG" -std=c11 -Wall -Wextra -Werror -c "$ORES_CONFORMANCE_ROOT/probes/llvm-value-probe.c" -o "$tmp/probe.o"
"$ORES_CLANG" "$tmp/guest.o" "$tmp/probe.o" -o "$tmp/execute"
"$tmp/execute"
