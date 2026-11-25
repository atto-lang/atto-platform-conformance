#!/usr/bin/env bash
# Source-local, host-only ADT conformance verification.
# This does not execute any compiler or certify backend guest parity.
set -euo pipefail

fail() {
  printf 'ADT_HOST_ONLY_NOT_VERIFIED: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  fail 'usage: scripts/verify-adt-conformance-head.sh <exact-40-char-source-commit-sha>'
fi
expected_sha=$1

for tool in git python3 node; do
  command -v "$tool" >/dev/null 2>&1 || fail "required executable not found: $tool"
done

root=$(git rev-parse --show-toplevel 2>/dev/null) || fail 'must be invoked inside the source Git checkout'
cd "$root"
actual_sha=$(git rev-parse --verify HEAD 2>/dev/null) || fail 'unresolvable source commit'
[[ "$actual_sha" == "$expected_sha" ]] || fail "source HEAD mismatch: expected $expected_sha, got $actual_sha"
source_tree=$(git rev-parse --verify 'HEAD^{tree}') || fail 'unresolvable source tree'

node_major=$(node -p 'Number(process.versions.node.split(".")[0])') || fail 'cannot inspect Node version'
[[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 22 )) || fail "Node >= 22 required, got $(node --version)"

for path in \
  scripts/verify-raw-worktree.py \
  tests/enum-semantics-v1.test.mjs \
  tests/enum-semantics-v1-mutations.test.mjs \
  tests/enum-semantics-v2-six-backend.test.mjs \
  contracts/enum-semantics-v1.json \
  contracts/enum-semantics-v2.json; do
  [[ -f "$path" && ! -L "$path" ]] || fail "required regular source file missing: $path"
done

printf 'ADT_HOST_SOURCE_SHA=%s\nADT_HOST_SOURCE_TREE=%s\nADT_HOST_NODE_VERSION=%s\n' \
  "$actual_sha" "$source_tree" "$(node --version)"

# Verify every tracked blob against the Git index without invoking clean/smudge filters.
# The self-test must succeed as well; a broken integrity verifier fails closed.
python3 scripts/verify-raw-worktree.py --self-test
python3 scripts/verify-raw-worktree.py .

# Require explicit test files. A broad npm test success alone does not establish
# that all three ADT integrity and mutation suites executed.
node --test \
  tests/enum-semantics-v1.test.mjs \
  tests/enum-semantics-v1-mutations.test.mjs \
  tests/enum-semantics-v2-six-backend.test.mjs

# Reject source modifications made during the tests.
python3 scripts/verify-raw-worktree.py .
[[ "$(git rev-parse --verify HEAD)" == "$expected_sha" ]] || fail 'source commit changed during test execution'
[[ "$(git rev-parse --verify 'HEAD^{tree}')" == "$source_tree" ]] || fail 'source tree changed during test execution'
printf 'ADT_HOST_ONLY_PASS=1\nADT_GUEST_PARITY_CERTIFIED=0\n'