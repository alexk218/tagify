#!/bin/bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
SDK="$(bash "$SOURCE/prepare-sparkle.sh")"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tagify-sparkle-e2e.XXXXXX")"
EVIDENCE="${TAGIFY_UPDATE_QA_DIR:-$ROOT/evidence}"
mkdir -p "$EVIDENCE" "$ROOT/served"
SERVER_PID=''
trap 'if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; rm -rf "$ROOT"' EXIT
# A disposable signing seed never enters the Keychain, source, logs or production feed.
cat > "$ROOT/key.swift" <<'SWIFT'
import Foundation
import CryptoKit
let key = Curve25519.Signing.PrivateKey()
try key.rawRepresentation.base64EncodedString().write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: CommandLine.arguments[1])
try key.publicKey.rawRepresentation.base64EncodedString().write(toFile: CommandLine.arguments[2], atomically: true, encoding: .utf8)
SWIFT
xcrun swift "$ROOT/key.swift" "$ROOT/private-key" "$ROOT/public-key"
cat > "$ROOT/server.py" <<'PY'
import http.server, sys, os
os.chdir(sys.argv[1])
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), http.server.SimpleHTTPRequestHandler)
open(sys.argv[2], 'w').write(str(server.server_port))
server.serve_forever()
PY
python3 "$ROOT/server.py" "$ROOT/served" "$ROOT/port" > "$EVIDENCE/http.log" 2>&1 & SERVER_PID=$!
for ATTEMPT in {1..50}; do [ -f "$ROOT/port" ] && break; sleep 0.1; done
PORT="$(cat "$ROOT/port")"
xcrun swiftc -swift-version 5 -warnings-as-errors -F "$SDK" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
    "$SOURCE/InstallerUpdater.swift" "$SOURCE/tests/self-update/main.swift" -o "$ROOT/Fixture"
for SCENARIO in ${TAGIFY_UPDATE_TEST_SCENARIOS:-success cancel corrupt-archive corrupt-feed offline}; do
    CASE="$ROOT/served/$SCENARIO"; mkdir -p "$CASE" "$ROOT/installed/$SCENARIO"
    NEW="$CASE/Tagify Update Test.app"; OLD="$ROOT/installed/$SCENARIO/Tagify Update Test.app"
    mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Frameworks"
    cp "$ROOT/Fixture" "$NEW/Contents/MacOS/Fixture"
    ditto "$SDK/Sparkle.framework" "$NEW/Contents/Frameworks/Sparkle.framework"
    python3 - "$SOURCE/Info.plist" "$NEW/Contents/Info.plist" "$ROOT/public-key" "$PORT" "$SCENARIO" "$EVIDENCE/$SCENARIO.log" <<'PY'
import plistlib, sys, uuid, os
p=plistlib.load(open(sys.argv[1], 'rb'))
p.update(CFBundleName='Tagify Update Test',CFBundleDisplayName='Tagify Update Test',CFBundleIdentifier='fm.tagify.updater-test.'+uuid.uuid4().hex,CFBundleExecutable='Fixture',CFBundleVersion='2',CFBundleShortVersionString='2.0',SUPublicEDKey=open(sys.argv[3]).read(),SUFeedURL='http://127.0.0.1:'+sys.argv[4]+'/'+sys.argv[5]+'/appcast.xml',FixtureLog=sys.argv[6],FixtureScenario=sys.argv[5],FixtureManual=os.environ.get("TAGIFY_UPDATE_TEST_MANUAL")=="1",NSAppTransportSecurity={'NSAllowsLocalNetworking':True,'NSAllowsArbitraryLoads':True})
plistlib.dump(p,open(sys.argv[2],'wb'))
PY
    codesign --force --sign - "$NEW" >/dev/null 2>&1
    ditto "$NEW" "$OLD"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 1' "$OLD/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 1.0' "$OLD/Contents/Info.plist"
    codesign --force --sign - "$OLD" >/dev/null 2>&1
    ditto -c -k --keepParent "$NEW" "$CASE/update.zip"
    rm -rf "$NEW"
    "$SDK/bin/generate_appcast" --ed-key-file "$ROOT/private-key" --maximum-deltas 0 --download-url-prefix "http://127.0.0.1:$PORT/$SCENARIO/" "$CASE" > "$EVIDENCE/$SCENARIO-appcast.log" 2>&1
    if [ "$SCENARIO" = corrupt-archive ]; then printf 'tamper' >> "$CASE/update.zip"; fi
    if [ "$SCENARIO" = corrupt-feed ]; then sed -i '' 's/<title>/<title>Tampered /' "$CASE/appcast.xml"; fi
    if [ "$SCENARIO" = offline ]; then mv "$CASE/appcast.xml" "$CASE/unavailable.xml"; fi
    printf "keep my preferences\n" > "$ROOT/installed/$SCENARIO/preferences.txt"
    "$OLD/Contents/MacOS/Fixture" > "$EVIDENCE/$SCENARIO-process.log" 2>&1 & OLD_PID=$!
    for ATTEMPT in {1..450}; do
        if [ -f "$EVIDENCE/$SCENARIO.log" ] && /usr/bin/grep -Eq 'relaunched-new|alert|cancelled|timeout|start-failed' "$EVIDENCE/$SCENARIO.log"; then break; fi
        sleep 0.1
    done
    wait "$OLD_PID" || true
    python3 - "$SCENARIO" "$EVIDENCE/$SCENARIO.log" "$OLD/Contents/Info.plist" <<'PY'
import sys,plistlib,pathlib
assert (pathlib.Path(sys.argv[3]).parents[2]/'preferences.txt').read_text() == 'keep my preferences\n'
scenario, path=sys.argv[1:3]
log=open(path).read(); version=plistlib.load(open(sys.argv[3],'rb'))['CFBundleVersion']
assert 'timeout' not in log and 'start-failed' not in log, log
if scenario=='success':
    assert 'relaunched-new' in log and 'will-relaunch' in log and version=='2', log
    old=next(line.split()[-1] for line in log.splitlines() if line.startswith('launched-old'))
    new=next(line.split()[-1] for line in log.splitlines() if line.startswith('relaunched-new'))
    assert old!=new, 'Old process remained active'
else:
    assert version=='1' and 'relaunched-new' not in log, log
    assert ('cancelled' if scenario=='cancel' else 'alert') in log, log
    assert 'finished' in log, 'Update session did not unlock the manager: '+log
    if scenario=='corrupt-archive': assert 'download-failed' in log and '\ndownloaded ' not in log, log
print('PASS: real Sparkle '+scenario)
PY
done
