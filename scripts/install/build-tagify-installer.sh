#!/bin/bash
set -euo pipefail

# Build on macOS with Xcode Command Line Tools; end users need neither Xcode nor Homebrew.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/macos"
BUILD_DIR="$SCRIPT_DIR/.build"
APP="$BUILD_DIR/Tagify Manager.app"
NOTARIZE=0
if [ "${1:-}" = "--notarize" ]; then NOTARIZE=1
elif [ "$#" -gt 0 ]; then echo "Usage: $0 [--notarize]" >&2; exit 1; fi
if [ "$(uname -s)" != "Darwin" ]; then echo "Build the Mac installer on macOS." >&2; exit 1; fi
if [ "$NOTARIZE" -eq 1 ]; then
    : "${TAGIFY_CODESIGN_IDENTITY:?Set your Developer ID Application identity}"
    : "${TAGIFY_INSTALLER_SIGN_IDENTITY:?Set your Developer ID Installer identity}"
    : "${TAGIFY_NOTARY_PROFILE:?Set a notarytool Keychain profile}"
fi

SPARKLE_SDK="$(bash "$SOURCE_DIR/prepare-sparkle.sh")"
mkdir -p "$BUILD_DIR"
rm -rf "$APP" "$BUILD_DIR/payload" "$BUILD_DIR/dmg" "$BUILD_DIR/Tagify.iconset"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks" "$BUILD_DIR/payload" "$BUILD_DIR/dmg"
ditto "$SPARKLE_SDK/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
cp "$SOURCE_DIR/Info.plist" "$APP/Contents/Info.plist"
ditto "$SOURCE_DIR/Assets" "$APP/Contents/Resources/Assets"
node "$SCRIPT_DIR/analytics/build-config.mjs" "$APP/Contents/Resources/InstallerAnalytics.json"
for ARCH in arm64 x86_64; do
    xcrun swiftc -swift-version 5 -warnings-as-errors -O -target "$ARCH-apple-macos12.0" -F "$SPARKLE_SDK" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
        "$SOURCE_DIR/InstallerAnalytics.swift" "$SOURCE_DIR/InstallerCore.swift" "$SOURCE_DIR/InstallerRecovery.swift" "$SOURCE_DIR/InstallerDiscovery.swift" "$SOURCE_DIR/InstallerMaintenance.swift" "$SOURCE_DIR/InstallerState.swift" "$SOURCE_DIR/InstallerPresentation.swift" "$SOURCE_DIR/InstallerAnalyticsUI.swift" "$SOURCE_DIR/InstallerUpdater.swift" "$SOURCE_DIR/InstallerUITests.swift" "$SOURCE_DIR/main.swift" -o "$BUILD_DIR/TagifyInstaller-$ARCH"
done
lipo -create "$BUILD_DIR/TagifyInstaller-arm64" "$BUILD_DIR/TagifyInstaller-x86_64" -output "$APP/Contents/MacOS/TagifyInstaller"
xcrun swift "$SOURCE_DIR/render-icon.swift" "$BUILD_DIR/Tagify.iconset"
iconutil -c icns "$BUILD_DIR/Tagify.iconset" -o "$APP/Contents/Resources/Tagify.icns"
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string Tagify" "$APP/Contents/Info.plist"
IDENTITY="${TAGIFY_CODESIGN_IDENTITY:--}"
SIGN_ARGS=(--force --sign "$IDENTITY")
if [ "$IDENTITY" = "-" ]; then SIGN_ARGS+=(--timestamp=none)
else SIGN_ARGS+=(--options runtime --timestamp); fi
FRAMEWORK="$APP/Contents/Frameworks/Sparkle.framework"
for COMPONENT in "$FRAMEWORK/Versions/B/XPCServices/Installer.xpc" "$FRAMEWORK/Versions/B/XPCServices/Downloader.xpc" "$FRAMEWORK/Versions/B/Autoupdate" "$FRAMEWORK/Versions/B/Updater.app" "$FRAMEWORK"; do
    codesign "${SIGN_ARGS[@]}" --preserve-metadata=entitlements "$COMPONENT"
done
codesign "${SIGN_ARGS[@]}" "$APP"
codesign --verify --deep --strict "$APP"

if [ "$NOTARIZE" -eq 1 ]; then
    ditto -c -k --keepParent "$APP" "$BUILD_DIR/notarize-app.zip"
    xcrun notarytool submit "$BUILD_DIR/notarize-app.zip" --keychain-profile "$TAGIFY_NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP"
fi

cp "$SOURCE_DIR/README.txt" "$BUILD_DIR/dmg/READ ME.txt"
if [ "$NOTARIZE" -eq 0 ]; then
    cat >> "$BUILD_DIR/dmg/READ ME.txt" <<'NOTICE'

This build has not been notarized by Apple. For a downloaded build that macOS
blocks, open System Settings > Privacy & Security and use Open Anyway after
trying to open Tagify Manager. Only do this for a copy you obtained from Alex.
NOTICE
fi
ditto "$APP" "$BUILD_DIR/dmg/Tagify Manager.app"
ln -s /Applications "$BUILD_DIR/dmg/Applications"
rm -f "$SCRIPT_DIR/TagifyInstaller-mac.dmg" "$SCRIPT_DIR/TagifyInstaller-mac.zip"
hdiutil create -volname "Tagify Manager" -srcfolder "$BUILD_DIR/dmg" -format UDZO "$SCRIPT_DIR/TagifyInstaller-mac.dmg"
ditto -c -k --keepParent "$APP" "$SCRIPT_DIR/TagifyInstaller-mac.zip"

# Keep the historical Tagify.pkg path for the public-source release workflow.
# The package places the GUI in Applications; the only privileged script launches it as the console user.
ditto "$APP" "$BUILD_DIR/payload/Tagify Manager.app"
PKG_ARGS=(--root "$BUILD_DIR/payload" --install-location /Applications
    --identifier fm.tagify.installer --version "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SOURCE_DIR/Info.plist")" --scripts "$SOURCE_DIR/package-scripts")
if [ -n "${TAGIFY_INSTALLER_SIGN_IDENTITY:-}" ]; then PKG_ARGS+=(--sign "$TAGIFY_INSTALLER_SIGN_IDENTITY"); fi
pkgbuild "${PKG_ARGS[@]}" "$SCRIPT_DIR/Tagify.pkg"
if [ "$NOTARIZE" -eq 1 ]; then
    for ARTIFACT in "$SCRIPT_DIR/TagifyInstaller-mac.dmg" "$SCRIPT_DIR/Tagify.pkg"; do
        xcrun notarytool submit "$ARTIFACT" --keychain-profile "$TAGIFY_NOTARY_PROFILE" --wait
        xcrun stapler staple "$ARTIFACT"
    done
fi
printf '\nBuilt Intel + Apple Silicon installers:\n%s\n%s\n%s\n' \
    "$SCRIPT_DIR/TagifyInstaller-mac.dmg" "$SCRIPT_DIR/TagifyInstaller-mac.zip" "$SCRIPT_DIR/Tagify.pkg"
if [ "$NOTARIZE" -eq 0 ]; then echo "Local build only: Apple notarization has not been performed."; fi
