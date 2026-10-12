#!/bin/bash
set -euo pipefail
# Pinned official binary distribution. No package-manager or runtime dependency for users.
ROOT="$(cd "$(dirname "$0")/.." && pwd)/.build"
VERSION=2.10.0
ARCHIVE="$ROOT/Sparkle-$VERSION.tar.xz"
SDK="$ROOT/Sparkle-$VERSION"
mkdir -p "$ROOT"
if [ ! -f "$ARCHIVE" ]; then
    TEMPORARY="$(mktemp "$ROOT/sparkle-download.XXXXXX")"
    trap 'rm -f "$TEMPORARY"' EXIT
    curl --fail --location --proto '=https' --proto-redir '=https' --retry 2 --max-time 120 \
        "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz" -o "$TEMPORARY" >&2
    mv "$TEMPORARY" "$ARCHIVE"
fi
printf '%s  %s\n' c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c "$ARCHIVE" | shasum -a 256 --check >&2
if [ ! -d "$SDK/Sparkle.framework" ]; then
    mkdir -p "$SDK"
    tar -xf "$ARCHIVE" -C "$SDK"
fi
codesign --verify --deep --strict "$SDK/Sparkle.framework" >&2
printf '%s\n' "$SDK"
