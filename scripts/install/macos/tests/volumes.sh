#!/bin/bash
set -euo pipefail
TEST_BINARY="$1"
VOLUME_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tagify-volume-tests.XXXXXX")"
MOUNT="$VOLUME_TEST_DIR/mount"
MOUNTED=0
cleanup() {
    if [ "$MOUNTED" = 1 ] && ! hdiutil detach "$MOUNT" >/dev/null 2>&1; then
        echo "Couldn't detach the test volume; preserved $VOLUME_TEST_DIR for cleanup." >&2
        return
    fi
    rm -rf "$VOLUME_TEST_DIR"
}
trap cleanup EXIT
mkdir -p "$MOUNT"
hdiutil create -size 64m -fs HFS+ -volname 'Tagify Test Volume' "$VOLUME_TEST_DIR/test.dmg" >/dev/null
hdiutil attach -nobrowse -mountpoint "$MOUNT" "$VOLUME_TEST_DIR/test.dmg" >/dev/null
MOUNTED=1
"$TEST_BINARY" --volume-fixture "$MOUNT" writable
hdiutil detach "$MOUNT" >/dev/null
MOUNTED=0
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$VOLUME_TEST_DIR/test.dmg" >/dev/null
MOUNTED=1
"$TEST_BINARY" --volume-fixture "$MOUNT" readonly
