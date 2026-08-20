#!/bin/bash
set -euo pipefail

name=firefox-auto-refresh-tab
root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

version="${1:-}"
if [ -z "$version" ]; then
  described="$(git describe --tags --long 2>/dev/null || true)"
  if [ -z "$described" ]; then
    echo "No git tag found. Create a tag (e.g. git tag 1.2.6) or pass a version argument." >&2
    exit 1
  fi
  if [[ ! "$described" =~ ^v?(.+)-([0-9]+)-g[0-9a-f]+$ ]]; then
    echo "Unexpected 'git describe' output: $described" >&2
    exit 1
  fi
  base="${BASH_REMATCH[1]}"
  ahead="${BASH_REMATCH[2]}"
  # commits past the tag become a 4th component, e.g. 1.2.5 + 3 commits -> 1.2.5.3
  if [ "$ahead" -gt 0 ] && [ "$(tr -cd '.' <<<"$base" | wc -c)" -lt 3 ]; then
    version="$base.$ahead"
  else
    version="$base"
  fi
fi

version="${version#v}"
if [[ ! "$version" =~ ^(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8})){0,3}$ ]]; then
  echo "Version '$version' is not a valid Firefox extension version (1 to 4 dot-separated numbers)." >&2
  exit 1
fi

rm -f "$name.xpi"
zip -r "$name.xpi" . \
  -x ".git/*" ".gitattributes" ".gitignore" ".github/*" ".github/" \
     "pack.bat" "pack.ps1" "pack.sh" "screenshots/*" "screenshots/" "$name.xpi"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
sed -E 's/"version"[[:space:]]*:[[:space:]]*"[^"]*"/"version": "'"$version"'"/' manifest.json >"$tmpdir/manifest.json"
if ! grep -q "\"version\": \"$version\"" "$tmpdir/manifest.json"; then
  echo "Failed to set the version in manifest.json." >&2
  exit 1
fi
(cd "$tmpdir" && zip -q "$root/$name.xpi" manifest.json)

echo "Packed $name.xpi (version $version)"
