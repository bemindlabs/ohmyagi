#!/usr/bin/env bash
#
# Build ohmyagi-<version>.pkg — run this ON A MAC (pkgbuild, productbuild,
# lipo and codesign exist only there). D-056.
#
#   packaging/macos/build-pkg.sh [--arm64 <bin>] [--x64 <bin>]
#
# The two binaries are cross-compiled anywhere with `bun run build:macos`
# (they land in dist/). Without --arm64/--x64 this script looks there, and
# builds them itself if bun is on PATH and they are missing.
#
# Signing is optional and read from the environment, never from a file here:
#   OHMYAGI_APP_IDENTITY        "Developer ID Application: …"  → codesign the binary (hardened runtime)
#   OHMYAGI_INSTALLER_IDENTITY  "Developer ID Installer: …"    → sign the .pkg
#   OHMYAGI_NOTARY_PROFILE      a `xcrun notarytool store-credentials` profile → notarize + staple
# Without the first, the binary is signed ad hoc — enough for the Mac that
# built it; another Mac's Gatekeeper will ask before running an unnotarized pkg.
#
# What the package installs: /usr/local/bin/ohmyagi, and /usr/local/bin/om-agi
# as a link to it. Nothing else — no data, no daemon, no LaunchAgent. After
# installing it opens Terminal with `ohmyagi setup` for the person logged in.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
arm64="$root/dist/ohmyagi-darwin-arm64"
x64="$root/dist/ohmyagi-darwin-x64"
while [ $# -gt 0 ]; do
  case "$1" in
    --arm64) arm64="$2"; shift 2 ;;
    --x64) x64="$2"; shift 2 ;;
    *) echo "usage: $0 [--arm64 <bin>] [--x64 <bin>]" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-pkg.sh: pkgbuild and productbuild exist only on macOS; run this on a Mac." >&2
  exit 2
fi
for tool in pkgbuild productbuild lipo codesign; do
  command -v "$tool" >/dev/null || { echo "build-pkg.sh: $tool not found (install the Xcode command line tools)" >&2; exit 2; }
done

version="$(sed -n 's/^export const VERSION = "\(.*\)";$/\1/p' "$root/src/version.ts")"
[ -n "$version" ] || { echo "build-pkg.sh: could not read the version from src/version.ts" >&2; exit 1; }

if [ ! -f "$arm64" ] || [ ! -f "$x64" ]; then
  command -v bun >/dev/null || { echo "build-pkg.sh: $arm64 or $x64 is missing and bun is not on PATH to build them" >&2; exit 1; }
  (cd "$root" && bun run build:macos)
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/root/usr/local/bin" "$work/resources"

bin="$work/root/usr/local/bin/ohmyagi"
lipo -create "$arm64" "$x64" -output "$bin"
chmod 755 "$bin"
ln -s ohmyagi "$work/root/usr/local/bin/om-agi"

if [ -n "${OHMYAGI_APP_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$OHMYAGI_APP_IDENTITY" "$bin"
else
  codesign --force --sign - "$bin"
fi
codesign --verify "$bin"
"$bin" --version | grep -qx "$version" || { echo "build-pkg.sh: the binary does not report $version" >&2; exit 1; }

cp "$here/resources/welcome.html" "$here/resources/conclusion.html" "$work/resources/"
cp "$root/LICENSE" "$work/resources/LICENSE.txt"
sed "s/@VERSION@/$version/g" "$here/distribution.xml" > "$work/distribution.xml"

pkgbuild \
  --root "$work/root" \
  --identifier tech.bemind.ohmyagi \
  --version "$version" \
  --install-location / \
  --scripts "$here/scripts" \
  "$work/ohmyagi-component.pkg"

out="$root/dist/ohmyagi-$version.pkg"
# `${sign[@]+…}` below, not `"${sign[@]}"`: macOS ships bash 3.2, where an
# empty array under `set -u` is an unbound variable.
sign=()
if [ -n "${OHMYAGI_INSTALLER_IDENTITY:-}" ]; then sign=(--sign "$OHMYAGI_INSTALLER_IDENTITY"); fi
productbuild \
  --distribution "$work/distribution.xml" \
  --resources "$work/resources" \
  --package-path "$work" \
  ${sign[@]+"${sign[@]}"} \
  "$out"

if [ -n "${OHMYAGI_NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$out" --keychain-profile "$OHMYAGI_NOTARY_PROFILE" --wait
  xcrun stapler staple "$out"
fi

echo "built $out"
if [ -z "${OHMYAGI_INSTALLER_IDENTITY:-}" ]; then
  echo "  unsigned: open it with right-click → Open, or sign it (see the header of this script)."
fi
exit 0
