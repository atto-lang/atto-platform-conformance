#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
repo_dir="$PWD"

# This is a private, temporary, exact-blob test subset from Wasm PR #403.
# No source secrets, tokens, source-org checkout or PR success claims.
python3 - <<'PY'
import json
import subprocess
from pathlib import Path
manifest = json.loads(Path("ci/tenant-wasm/mirror-manifest.json").read_text())
for path, expected in manifest["source_blobs"].items():
    actual = subprocess.check_output(["git", "hash-object", path], text=True).strip()
    if actual != expected:
        raise SystemExit(f"SOURCE_BLOB_MISMATCH: {path}: {actual} != {expected}")
print(f"source_git_blobs_verified={len(manifest['source_blobs'])}")
print(f"source_commit={manifest['origin']['commit']}")
print("scope=selected_private_source_blobs_only_not_original_PR_CI")
PY

cargo test --locked --manifest-path aot-host/precompile/Cargo.toml
cargo test --locked --manifest-path aot-host/run/Cargo.toml
cargo build --locked --manifest-path aot-host/precompile/Cargo.toml
cargo build --locked --manifest-path aot-host/run/Cargo.toml --features insecure-dev-caller-pin
builder="$repo_dir/aot-host/precompile/target/debug/oreslang-aot-build"
runner="$repo_dir/aot-host/run/target/debug/oreslang-aot-run"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The same real mutable global test already required by source PR #173.
cat > "$tmp/tenant-counter.ll" <<'LLVM'
target triple = "wasm32-unknown-unknown"
@counter = internal global i64 0, align 8
define i64 @main() {
entry:
  %old = load volatile i64, ptr @counter, align 8
  %next = add i64 %old, 1
  store volatile i64 %next, ptr @counter, align 8
  ret i64 %next
}
LLVM
clang --target=wasm32 -x ir -Oz -nostdlib -Wl,--no-entry -Wl,--export=main \
  -Wl,--initial-memory=131072 -Wl,--max-memory=131072 \
  -o "$tmp/tenant-counter.wasm" "$tmp/tenant-counter.ll"
"$builder" "$tmp/tenant-counter.wasm" "$(sha256sum "$tmp/tenant-counter.wasm" | cut -d ' ' -f 1)" \
  "$tmp/tenant-counter.cwasm" > "$tmp/tenant-counter.meta"
tenant_pin="$(sed -n 's/^aot_sha256=//p' "$tmp/tenant-counter.meta")"
[[ "$tenant_pin" =~ ^[0-9a-f]{64}$ ]] || { echo 'missing baseline AOT digest' >&2; exit 1; }
test "$("$runner" --tenant-isolation-smoke "$tmp/tenant-counter.cwasm" "$tenant_pin")" = "wasmtime_tenant_store_isolation=ok"
echo "native_wasmtime_store_isolation=ok"

# The new PR #403 guest. First two turns terminate; third turns forever.
# Node validates the guest without triggering the endless third turn.
cat > "$tmp/tenant-fuel-starvation.c" <<'C'
typedef unsigned long long u64;
static volatile u64 counter;
long long main(void) {
    u64 current = ++counter;
    if (current == 3) {
        volatile u64 busy = 0;
        for (;;) {
            ++busy;
        }
    }
    return (long long)current;
}
C
clang --target=wasm32 -x c -Wno-main-return-type -O0 -nostdlib \
  -Wl,--no-entry -Wl,--export=main -Wl,-z,stack-size=16384 \
  -Wl,--initial-memory=65536 -Wl,--max-memory=131072 \
  -o "$tmp/tenant-fuel-starvation.wasm" "$tmp/tenant-fuel-starvation.c"
node --input-type=module - "$tmp/tenant-fuel-starvation.wasm" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const wasm=readFileSync(process.argv[2]);
assert.ok(WebAssembly.validate(wasm));
const module=new WebAssembly.Module(wasm);
assert.deepEqual(WebAssembly.Module.imports(module), []);
assert.deepEqual(WebAssembly.Module.exports(module).map(({name,kind})=>[name,kind]).sort(),
  [['main','function'],['memory','memory']].sort());
const instance=new WebAssembly.Instance(module);
assert.deepEqual([instance.exports.main(),instance.exports.main()], [1n,2n]);
console.log('node_guest_fixture_initial_turns=ok');
JS
"$builder" "$tmp/tenant-fuel-starvation.wasm" \
  "$(sha256sum "$tmp/tenant-fuel-starvation.wasm" | cut -d ' ' -f 1)" \
  "$tmp/tenant-fuel-starvation.cwasm" > "$tmp/tenant-fuel-starvation.meta"
spin_pin="$(sed -n 's/^aot_sha256=//p' "$tmp/tenant-fuel-starvation.meta")"
[[ "$spin_pin" =~ ^[0-9a-f]{64}$ ]] || { echo 'missing fuel AOT digest' >&2; exit 1; }
test "$("$runner" --tenant-fuel-starvation-smoke "$tmp/tenant-fuel-starvation.cwasm" "$spin_pin" 1000000)" = "wasmtime_tenant_fuel_starvation=ok"
if "$runner" --tenant-fuel-starvation-smoke "$tmp/tenant-fuel-starvation.cwasm" "$(printf '0%.0s' {1..64})" >/dev/null 2>&1; then
  echo 'incorrect digest was accepted by debug AOT runner' >&2
  exit 1
fi
echo 'native_wasmtime_tenant_fuel_and_reincarnation=ok'
echo 'EVIDENCE_SCOPE=PRIVATE_EXACT_SOURCE_BLOBS_NOT_FULL_PR_CI_NOT_PRODUCTION_SANDBOX'
