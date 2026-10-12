#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/tagify-terminal-test.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/home/.config/spicetify/CustomApps/tagify"
printf '%s\n' '#!/bin/sh' 'echo Darwin' > "$TEMP/bin/uname"
printf '%s\n' '#!/bin/sh' 'echo "Unexpected download" >&2' 'exit 99' > "$TEMP/bin/curl"
chmod +x "$TEMP/bin/uname" "$TEMP/bin/curl"
printf 'Keep installed Tagify' > "$TEMP/home/.config/spicetify/CustomApps/tagify/index.js"
HOME="$TEMP/home" PATH="$TEMP/bin:/usr/bin:/bin" /bin/bash "$SOURCE_DIR/../../../../install.sh" > "$TEMP/output"
test "$(cat "$TEMP/home/.config/spicetify/CustomApps/tagify/index.js")" = 'Keep installed Tagify'
grep -q 'https://tagify.fm/download/mac' "$TEMP/output"
grep -q 'has not been changed' "$TEMP/output"
printf '%s\n' 'PASS: historical Mac terminal entry leaves setup untouched and provides manager instructions.'
