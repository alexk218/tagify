# Building the Mac installer

The native app supports macOS 12+ on Intel and Apple Silicon. End users need Spotify and an internet connection; they do not need Homebrew, a terminal, or development tools. Like the Windows full installer, this installs Spicetify and Tagify, and requires the user to install Spotify and sign in first. Marketplace is preserved if already installed and is not added automatically.

The Mac manager shares the Windows installer product logos, dark setup cards, typography hierarchy, and full-width green primary action. Mac window controls, keyboard navigation, scrolling, and accessibility remain native. The three product PNGs in `Assets/` are copied from the Windows installer's `TagifyInstaller/Assets` and bundled at build time, so they display offline. Setup, tutorial, and package instructions direct users to Spotify's official Mac desktop download; the Windows Microsoft Store restriction is not presented as a Mac limitation. Spicetify Marketplace remains compatible.

Build on a Mac with Xcode Command Line Tools:

```sh
npm run test:installer:mac --workspace=tagify-secret
npm run build:installer:mac --workspace=tagify-secret
```

Artifacts are in `scripts/install/`:

- `TagifyInstaller-mac.dmg`: recommended download, containing the app, an Applications shortcut, and instructions. The app can run directly from the disk image.
- `TagifyInstaller-mac.zip`: the same app, packaged for ZIP download.
- `Tagify.pkg`: installs the app in `/Applications` and opens it for the signed-in console user. Without a console session, launch the app manually afterward. This path remains compatible with the existing public-source synchronization script.

The source app and intermediate builds are in the ignored `.build` folder. DMG and ZIP outputs are ignored; the existing tracked PKG is refreshed for the public-source release workflow. A local build uses an ad hoc signature and **has not been notarized by Apple**. Don't describe it as a Gatekeeper-approved release. A downloaded unsigned build may need System Settings → Privacy & Security → Open Anyway after a launch attempt.

For public distribution, use Developer ID certificates and a `notarytool` Keychain profile:

```sh
export TAGIFY_CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export TAGIFY_INSTALLER_SIGN_IDENTITY='Developer ID Installer: Your Name (TEAMID)'
export TAGIFY_NOTARY_PROFILE='tagify-notary'
npm run build:installer:mac --workspace=tagify-secret -- --notarize
```

The build signs the universal binary with hardened runtime, notarizes and staples the app, then builds and notarizes the DMG and PKG. It stops on rejected submissions. The ZIP contains the stapled app. Signing and publishing are separate actions: upload the verified artifacts only through the approved release workflow. Configure the Keychain profile outside the repository; never commit signing secrets.

Verify the packaged app before sharing:

```sh
lipo -archs 'scripts/install/.build/Tagify Installer.app/Contents/MacOS/TagifyInstaller'
codesign --verify --deep --strict 'scripts/install/.build/Tagify Installer.app'
pkgutil --check-signature scripts/install/Tagify.pkg
# For a notarized distribution:
spctl --assess --type execute --verbose 'scripts/install/.build/Tagify Installer.app'
xcrun stapler validate scripts/install/TagifyInstaller-mac.dmg
xcrun stapler validate scripts/install/Tagify.pkg
```

Check the native welcome, progress, recovery, and success screens. `TagifyInstaller --preview ready|progress|failure|success|missing|repair|tagify-update|spicetify-update|pending|small|tutorial|update` renders read-only examples without setup work. Actual install validation uses an isolated Spotify app and separate config/state locations, never a second writable copy of the real user's library. The test suite covers first installs, reinstalls, Spotify updates, setting-only changes, rollback, missing sign-in, corrupt downloads, unsafe archives, recovery-key privacy, preserved custom apps/themes, and concurrency. A test-only AppKit harness exercises the native Install, Apply Changes, retry, tutorial, and update controls. It captures representative windows and checks the persistent primary action at small sizes. Set `TAGIFY_INSTALLER_QA_DIR=/absolute/path` to retain PNG previews. The harness and fixtures are excluded from production builds.

The installer checks the existing setup before offering Install, Update, Repair, or Open Spotify. Opening a healthy setup never reinstalls or closes Spotify. Explicit installation and repair close Spotify gracefully before mutation, verify downloads first, and always apply Tagify even if it is already configured. Quitting is disabled during work; minimizing stays available. A failed install restores the prior Tagify/CLI/config/state, Spotify app files, and Spotify update setting. It leaves logs at `~/Library/Logs/Tagify` and snapshots at `~/Library/Application Support/Tagify/Installer Backups`. Each snapshot has `restore.json`, which maps numbered saved files back to their original paths. Keep Spotify closed when manually restoring a snapshot. Saved Spotify user data is never replaced by these snapshots.

The **Block Spotify updates** checkbox defaults to checked. After applying Tagify, the installer runs `spicetify --no-restart spotify-updates block`; unchecked runs `spotify-updates unblock`, including when a previous installation blocked updates. Changing the checkbox after success requires clicking **Apply Changes**. This separate operation snapshots and verifies only the update setting, uses the same account lock, and restores flags on failure. An unchanged setting skips the CLI and leaves Spotify open. Changing it gracefully closes Spotify because the upstream Mac command calls `pkill Spotify` even with `--no-restart`. Spicetify's [macOS implementation](https://github.com/spicetify/cli/blob/v2.45.3/src/cmd/block-updates.go) sets or clears the user immutable flag on `~/Library/Application Support/Spotify/PersistentCache/Update`. It doesn't patch the Mac executable. The engine verifies the actual flag and exercises real write and rename attempts because the CLI can report success despite a failed `chflags`. The immutable flag protects directory entries, not existing children or cached app execution. Before Spotify is asked to quit, a nonempty Update folder is moved into the operation's private backup as `pending-spotify-update`; the updater receives an empty locked folder. The native engine applies and verifies the flag before quitting Spotify to prevent a cached-update exit handoff; the subsequent CLI command and post-install checks confirm the final setting. No pending payload is deleted or patched. Setup detection accepts only a locked, empty staging folder. A failure restores the original folder, contents, and exact flags alongside the rest of the setup. `spotify-updates.json` records the original existence, flags, and optional pending-folder recovery location. When manually restoring a quarantined update, unlock the empty active folder, remove it only if empty, move the saved folder back to the recorded original path, and restore its recorded flags. Unblocking allows fresh downloads; it does not automatically requeue old saved updates. The command runs with `HOME` set to the selected account's home. Tests use isolated homes; real-command test harnesses must also substitute a harmless `pkill` in the child command's PATH to avoid closing the user's Spotify.

An administrator password is requested only when the chosen Spotify Resources directory isn't writable. The resulting ACL grants the signed-in user access to that directory; Spicetify itself never runs as root. This permission grant is not removed by file rollback. Canceling the prompt stops setup before files are replaced.

The installer uses Spicetify's documented [macOS paths and first-run requirements](https://spicetify.app/docs/getting-started) and Apple's [Developer ID notarization workflow](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Returning users, tutorial, and installer updates

`InstallerState.swift` reads the installed CLI version, Tagify files/config, applied
Spotify app files, and the actual update-folder flag. A stale Spotify backup,
missing applied files, or a broken CLI offers repair rather than a false ready
state. Local checks are bounded and independent of online checks. Newer stable Tagify and Spicetify releases offer **Update Tagify** or **Update setup**, with their existing versions shown alongside each component. The window
scrolls on smaller displays and keeps the primary action and Tutorial visible.

Installer choices live in `~/Library/Application Support/Tagify/Installer/preferences.json`
with private permissions. The update choice is recorded only after verification.
Tutorial page 2 includes an interactive link to Spotify’s official Mac download page.
The tutorial is completed only by its final **Got it** action. Closing it early
leaves it available on the next launch. Replays always start at the first page
and preserve both saved choices and pending checkbox changes.

The app checks the most recent 100 releases of `alexk218/tagify-installer` on
launch and with **Check again**. It selects the newest stable version containing
`TagifyInstaller-mac.dmg`, `TagifyInstaller-mac.zip`, or `Tagify.pkg` from that
repository, with a SHA-256 digest. Windows-only releases, drafts, prereleases,
invalid URLs, and downgrades are ignored. A failed check offers **Check again**
and doesn't prevent opening or setting up Tagify. GitHub's release API supplies
the version, notes, asset URL, and digest:
https://docs.github.com/en/rest/releases/releases

**Update now** saves a verified download without overwriting an existing file;
**Show download** reveals it for the user to open. It doesn't replace a running
Mac app or request unnecessary administrator access. **Later** preserves a
nonblocking reminder. Updating the installer and updating Tagify are separate.
No background service, login item, or notification permission is installed.

For publication, the release tag must match `CFBundleShortVersionString` in
`Info.plist`. The package version is read from that same file. Upload a Mac
asset with its exact supported filename alongside the appropriate release;
a Windows-only asset cannot notify Mac users. Version 1.0.0 prototypes have no
update checker, so their users need one manual upgrade to this build first.
Signing, Apple notarization, and public GitHub publication remain separate steps.

## Update-protection verification

Run the complete suite against the actual installed Spicetify CLI as well as the isolated command fixtures:

```sh
TAGIFY_TEST_REAL_SPICETIFY="$(command -v spicetify)" npm run test:installer:mac --workspace=tagify-secret
```

The real CLI uses a disposable home and a harmless `pkill` shim. It never touches the user's app, profile, or update folder. Tests prove write/rename denial, locked-but-nonempty detection, pending-app quarantine, exact bytes/permissions/flags recovery, retry, and successful writes/renames after unblocking. Those are operating-system checks, not evidence of a network-triggered Spotify upgrade. For a complete auto-update acceptance test, use an isolated outdated official client and require an unblocked control to download/install a newer version before comparing the blocked run. No-update, offline, or failed-start outcomes are inconclusive. Repeat for each supported Spotify updater change.

**Logs** and **Check again** are available beside Your setup, matching Windows. Logs opens the diagnostic window before or after installation; Check again refreshes local setup and online update checks without reinstalling. Logs remain available through View details while installation is running.
