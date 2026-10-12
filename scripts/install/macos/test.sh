#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
SPARKLE_SDK="$(bash "$SOURCE_DIR/prepare-sparkle.sh")"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tagify-installer-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
node --test "$SOURCE_DIR/../analytics/analytics.test.mjs"
xcrun swiftc -swift-version 5 -warnings-as-errors "$SOURCE_DIR/InstallerAnalytics.swift" "$SOURCE_DIR/InstallerCore.swift" "$SOURCE_DIR/InstallerRecovery.swift" "$SOURCE_DIR/InstallerDiscovery.swift" "$SOURCE_DIR/InstallerMaintenance.swift" "$SOURCE_DIR/InstallerState.swift" "$SOURCE_DIR/tests/Fixture.swift" "$SOURCE_DIR/tests/Analytics.swift" "$SOURCE_DIR/tests/UpdateProtection.swift" "$SOURCE_DIR/tests/Hardening.swift" "$SOURCE_DIR/tests/Maintenance.swift" "$SOURCE_DIR/tests/Volumes.swift" "$SOURCE_DIR/tests/main.swift" -o "$TEST_DIR/tests"
if [ "${TAGIFY_TEST_DISK_IMAGES:-0}" = "1" ]; then bash "$SOURCE_DIR/tests/volumes.sh" "$TEST_DIR/tests"; fi
"$TEST_DIR/tests"

xcrun swiftc -swift-version 5 -warnings-as-errors -D INSTALLER_UI_TESTS -F "$SPARKLE_SDK" -framework Sparkle -Xlinker -rpath -Xlinker "$SPARKLE_SDK" "$SOURCE_DIR/InstallerAnalytics.swift" "$SOURCE_DIR/InstallerCore.swift" "$SOURCE_DIR/InstallerRecovery.swift" "$SOURCE_DIR/InstallerDiscovery.swift" "$SOURCE_DIR/InstallerMaintenance.swift" "$SOURCE_DIR/InstallerState.swift" "$SOURCE_DIR/InstallerPresentation.swift" "$SOURCE_DIR/InstallerAnalyticsUI.swift" "$SOURCE_DIR/InstallerUpdater.swift" "$SOURCE_DIR/InstallerUITests.swift" "$SOURCE_DIR/tests/Fixture.swift" "$SOURCE_DIR/main.swift" -o "$TEST_DIR/TagifyInstaller"
"$TEST_DIR/TagifyInstaller" --self-test "${TAGIFY_INSTALLER_QA_DIR:-$TEST_DIR/previews}"

bash "$SOURCE_DIR/tests/terminal-entry.sh"
