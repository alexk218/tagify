#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tagify-installer-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
xcrun swiftc -swift-version 5 -warnings-as-errors "$SOURCE_DIR/InstallerCore.swift" "$SOURCE_DIR/InstallerState.swift" "$SOURCE_DIR/tests/Fixture.swift" "$SOURCE_DIR/tests/UpdateProtection.swift" "$SOURCE_DIR/tests/main.swift" -o "$TEST_DIR/tests"
"$TEST_DIR/tests"

xcrun swiftc -swift-version 5 -warnings-as-errors -D INSTALLER_UI_TESTS "$SOURCE_DIR/InstallerCore.swift" "$SOURCE_DIR/InstallerState.swift" "$SOURCE_DIR/InstallerPresentation.swift" "$SOURCE_DIR/InstallerUITests.swift" "$SOURCE_DIR/tests/Fixture.swift" "$SOURCE_DIR/main.swift" -o "$TEST_DIR/TagifyInstaller"
"$TEST_DIR/TagifyInstaller" --self-test "${TAGIFY_INSTALLER_QA_DIR:-$TEST_DIR/previews}"
