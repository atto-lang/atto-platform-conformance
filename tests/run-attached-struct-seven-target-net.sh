#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "$0")/../fixtures/attached-struct-seven-target-v1" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
project=verification/Ores.Net.AttachedStructFixtures/Ores.Net.AttachedStructFixtures.csproj
host=host/Ores.Net.NativeHost/Ores.Net.NativeHost.csproj
dotnet build "$project" -c Release
positive=0; negative=0
while IFS=$'\t' read -r name expected; do
  [[ "$name" =~ ^[a-z-]+\.atto$ ]]
  dll="$work/OresGenerated.dll"
  rm -f "$dll"
  if [[ "$expected" == reject ]]; then
    set +e
    dotnet run --no-build --project "$project" -c Release -- "$root/$name" "$dll" >"$work/log" 2>&1
    status=$?
    set -e
    test "$status" = 1
    test ! -e "$dll"
    grep -Eq 'E_[A-Z_]+' "$work/log"
    negative=$((negative+1)); continue
  fi
  dotnet run --no-build --project "$project" -c Release -- "$root/$name" "$dll"
  dotnet clean "$host" -c Release -r linux-x64 "-p:GeneratedAssembly=$dll"
  rm -rf "$work/published"
  dotnet publish "$host" -c Release -r linux-x64 -o "$work/published" "-p:GeneratedAssembly=$dll" -warnaserror
  app="$work/published/oreslang-app"
  file "$app" | grep -q 'ELF 64-bit'
  test ! -e "$work/published/OresGenerated.dll"
  test "$("$app")" = "$expected"
  positive=$((positive+1))
done < "$root/manifest.tsv"
test "$positive" = 3; test "$negative" = 8
echo "SEVEN_TARGET_RECEIPT target=net-native positive=$positive reject=$negative"
