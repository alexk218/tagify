#!/bin/bash
set -euo pipefail
# Run after notarization/stapling. This prepares files; it never publishes them.
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo "Usage: $0 notarized-manager.zip output-directory [previous-appcast.xml]" >&2; exit 1; fi
SOURCE="$(cd "$(dirname "$0")" && pwd)"
SDK="$(bash "$SOURCE/prepare-sparkle.sh")"
ARCHIVE="$1"; OUTPUT="$2"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SOURCE/Info.plist")"
TEMPORARY="$(mktemp -d "${TMPDIR:-/tmp}/tagify-appcast.XXXXXX")"
trap 'rm -rf "$TEMPORARY"' EXIT
ditto -x -k "$ARCHIVE" "$TEMPORARY"
APP="$TEMPORARY/Tagify Manager.app"
codesign --verify --deep --strict "$APP"
xcrun stapler validate "$APP"
for FIELD in CFBundleIdentifier CFBundleVersion CFBundleShortVersionString SUPublicEDKey SUFeedURL; do
    if [ "$(/usr/libexec/PlistBuddy -c "Print :$FIELD" "$APP/Contents/Info.plist")" != "$(/usr/libexec/PlistBuddy -c "Print :$FIELD" "$SOURCE/Info.plist")" ]; then
        echo "Archive $FIELD does not match this release's source. Refusing to sign its feed." >&2; exit 1
    fi
done
mkdir -p "$OUTPUT"
cp "$ARCHIVE" "$OUTPUT/TagifyInstaller-mac.zip"
cp "$SOURCE/UPDATE_NOTES.txt" "$OUTPUT/TagifyInstaller-mac.txt"
if [ "$#" -eq 3 ]; then cp "$3" "$OUTPUT/appcast.xml"; fi
"$SDK/bin/generate_appcast" --account fm.tagify.installer --maximum-deltas 0 --embed-release-notes \
    --download-url-prefix "https://tagify.fm/releases/manager/v$VERSION/" \
    --link https://tagify.fm "$OUTPUT"
"$SDK/bin/sign_update" --account fm.tagify.installer --verify "$OUTPUT/appcast.xml"
printf 'Prepared signed feed: %s/appcast.xml\nPublish the matching release assets first; publish this feed last.\n' "$OUTPUT"
