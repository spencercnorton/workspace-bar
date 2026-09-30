#!/usr/bin/env bash
# Build the release assets from this tree: the extension zip that
# `gnome-extensions install` takes, and a Debian package that installs the
# extension system-wide. Reproducible under SOURCE_DATE_EPOCH.
#   scripts/build.sh [out-dir]      (default: dist/)
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(realpath -m "${1:-$root/dist}")
pkg=gnome-shell-extension-workspace-bar
field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$root/metadata.json" "$1"; }
uuid=$(field uuid)
version=$(field version-name)
stamp=${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct 2>/dev/null || date +%s)}
export SOURCE_DATE_EPOCH="$stamp"
mkdir -p "$out"

payload=(extension.js metadata.json model.js stylesheet.css workspacesMenu.js)
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
(cd "$root" && cp "${payload[@]}" LICENSE NOTICE "$stage/")
chmod 0644 "$stage"/*
touch -d "@$stamp" "$stage"/*
rm -f "$out/workspace-bar.shell-extension.zip"
(cd "$stage" && TZ=UTC zip -qX "$out/workspace-bar.shell-extension.zip" "${payload[@]}" LICENSE NOTICE)

(cd "$root" && dpkg-buildpackage -us -uc -b)
mv "$root/../${pkg}_${version}_all.deb" "$out/"
rm -f "$root/../${pkg}_${version}"_*.buildinfo "$root/../${pkg}_${version}"_*.changes
# No grep -q below: it exits at the first match, dpkg-deb dies of SIGPIPE, and
# pipefail turns a good package into a failed build.
for file in "${payload[@]}"; do
    dpkg-deb -c "$out/${pkg}_${version}_all.deb" | grep -F "usr/share/gnome-shell/extensions/$uuid/$file" >/dev/null
done
ls -l "$out"
