#!/usr/bin/env bash
# Source-local reference-model acceptance. NEVER certifies Java/LLVM guest runtimes.
set -euo pipefail

if [[ $# -ne 2 || ! "$1" =~ ^[0-9a-f]{40}$ || ! "$2" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'usage: verify-actor-hop-exact-tree.sh EXPECTED_HEAD_SHA EXPECTED_ROOT_TREE_SHA' >&2
  exit 64
fi

cd "$(dirname "$0")/.."
head="$(git rev-parse --verify HEAD)"
tree="$(git rev-parse --verify 'HEAD^{tree}')"
if [[ "$head" != "$1" || "$tree" != "$2" ]]; then
  echo "FAIL: source identity mismatch (head=$head tree=$tree)" >&2
  exit 65
fi
if ! git diff --quiet HEAD -- || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo 'FAIL: worktree has tracked modifications or untracked files' >&2
  exit 66
fi

paths=(
  lib/actor-hop-trace.mjs
  tests/actor-hop-trace.test.mjs
  tests/actor-hop-hardening.test.mjs
  tests/actor-hop-property.test.mjs
  tests/actor-hop-descriptor-safety.test.mjs
  tests/actor-hop-unicode.test.mjs
)
for file in "${paths[@]}"; do
  git ls-files --error-unmatch -- "$file" >/dev/null
  mode="$(git ls-tree HEAD -- "$file" | awk '{print $1}')"
  [[ "$mode" == '100644' ]] || { echo "FAIL: non-regular or missing file: $file" >&2; exit 67; }
  committed="$(git rev-parse "HEAD:$file")"
  actual="$(git hash-object "$file")"
  [[ "$committed" == "$actual" ]] || { echo "FAIL: blob mismatch: $file" >&2; exit 68; }
done

major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$major" =~ ^[0-9]+$ && "$major" -ge 22 ]] || { echo 'FAIL: Node.js >=22 required' >&2; exit 69; }

printf 'SOURCE_MATCH head=%s tree=%s node=%s\n' "$head" "$tree" "$(node --version)"
node --test "${paths[@]:1}"
printf 'MODEL_ONLY_PASS head=%s tree=%s\n' "$head" "$tree"
