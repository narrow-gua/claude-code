#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_root="${1:-$project_root/../releases}"
version="$(node -p "require('$project_root/package.json').version")"
package_name="prism-windows-universal-$version"
work_root="$(mktemp -d)"
package_root="$work_root/$package_name"

cleanup() {
  rm -rf "$work_root"
}
trap cleanup EXIT

cd "$project_root"
bun run build

mkdir -p "$package_root"
cp -R dist "$package_root/dist"
cp scripts/windows/runtime-package.json "$package_root/dist/package.json"
NPM_CONFIG_CACHE="$work_root/npm-cache" npm install \
  --prefix "$package_root/dist" \
  --omit=dev \
  --ignore-scripts \
  --package-lock=false \
  --no-audit \
  --no-fund
cp scripts/windows/install.ps1 "$package_root/install.ps1"
cp scripts/windows/uninstall.ps1 "$package_root/uninstall.ps1"
cp scripts/windows/README.txt "$package_root/README.txt"

rg_version='15.0.1'
release_base="https://github.com/microsoft/ripgrep-prebuilt/releases/download/v$rg_version"
for target in x86_64-pc-windows-msvc aarch64-pc-windows-msvc; do
  archive="$work_root/ripgrep-$target.zip"
  curl -fsSL "$release_base/ripgrep-v$rg_version-$target.zip" -o "$archive"

  case "$target" in
    x86_64-*) runtime_arch='x64-win32' ;;
    aarch64-*) runtime_arch='arm64-win32' ;;
  esac

  destination="$package_root/dist/vendor/ripgrep/$runtime_arch"
  mkdir -p "$destination"
  unzip -p "$archive" rg.exe > "$destination/rg.exe"
done

(
  cd "$package_root"
  shasum -a 256 \
    install.ps1 \
    uninstall.ps1 \
    README.txt \
    dist/package.json \
    dist/node_modules/ws/package.json \
    dist/node_modules/ws/wrapper.mjs \
    dist/node_modules/opus-encdec/package.json \
    dist/node_modules/opus-encdec/dist/libopus-encoder.wasm.js \
    dist/cli.js \
    dist/cli-node.js \
    dist/vendor/ripgrep/x64-win32/rg.exe \
    dist/vendor/ripgrep/arm64-win32/rg.exe \
    > SHA256SUMS.txt
)

mkdir -p "$output_root"
artifact="$output_root/$package_name.zip"
rm -f "$artifact"
(
  cd "$work_root"
  zip -qr "$artifact" "$package_name"
)

(
  cd "$output_root"
  shasum -a 256 "$package_name.zip" > "$package_name.zip.sha256"
)
echo "$artifact"
