# Building the Mac installer

The native app supports macOS 12+ on Intel and Apple Silicon. End users need Spotify and an internet connection; they do not need Homebrew, a terminal, or development tools. Like the Windows full installer, this installs Spicetify and Tagify, and requires the user to install Spotify and sign in first. Marketplace is preserved if already installed and is not added automatically.

The Mac manager shares the Windows installer product logos, dark setup cards, typography hierarchy, and full-width green primary action. Mac window controls, keyboard navigation, scrolling, and accessibility remain native. The three product PNGs in `Assets/` are copied from the Windows installer's `TagifyInstaller/Assets` and bundled at build time, so they display offline. Setup, tutorial, and package instructions direct users to Spotify's official Mac desktop download; the Windows Microsoft Store restriction is not presented as a Mac limitation. Spicetify Marketplace remains compatible.

Build on a Mac with Xcode Command Line Tools and Node.js 22 or newer:

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
lipo -archs 'scripts/install/.build/Tagify Manager.app/Contents/MacOS/TagifyInstaller'
codesign --verify --deep --strict 'scripts/install/.build/Tagify Manager.app'
pkgutil --check-signature scripts/install/Tagify.pkg
# For a notarized distribution:
spctl --assess --type execute --verbose 'scripts/install/.build/Tagify Manager.app'
xcrun stapler validate scripts/install/TagifyInstaller-mac.dmg
xcrun stapler validate scripts/install/Tagify.pkg
```

Check the native welcome, progress, recovery, and success screens. `TagifyInstaller --preview ready|progress|failure|success|missing|repair|tagify-update|spicetify-update|pending|small|tutorial|update` renders read-only examples without setup work. Actual install validation uses an isolated Spotify app and separate config/state locations, never a second writable copy of the real user's library. The test suite covers first installs, reinstalls, Spotify updates, setting-only changes, rollback, missing sign-in, corrupt downloads, unsafe archives, recovery-key privacy, preserved custom apps/themes, and concurrency. A test-only AppKit harness exercises the native Install, Apply Changes, retry, tutorial, and update controls. It captures representative windows and checks the persistent primary action at small sizes. Set `TAGIFY_INSTALLER_QA_DIR=/absolute/path` to retain PNG previews. The harness and fixtures are excluded from production builds.

The installer checks the existing setup before offering Install, Update, Repair, or Open Spotify. Opening a healthy setup never reinstalls or closes Spotify. Explicit installation and repair close Spotify gracefully before mutation, verify downloads first, and always apply Tagify even if it is already configured. Quitting is disabled during work; minimizing stays available. A failed install restores the prior Tagify/CLI/config/state, Spotify app files, and Spotify update setting. It leaves logs at `~/Library/Logs/Tagify` and snapshots at `~/Library/Application Support/Tagify/Installer Backups`. Each snapshot has `restore.json`, which maps numbered saved files back to their original paths. Keep Spotify closed when manually restoring a snapshot. Saved Spotify user data is never replaced by these snapshots.

The **Block Spotify updates** checkbox defaults to checked. After applying Tagify, the installer runs `spicetify --no-restart spotify-updates block`; unchecked runs `spotify-updates unblock`, including when a previous installation blocked updates. Changing the checkbox after success requires clicking **Apply Changes**. This separate operation snapshots and verifies only the update setting, uses the same account lock, and restores flags on failure. An unchanged setting skips the CLI and leaves Spotify open. Standalone unblocking clears and verifies the user immutable flag directly, preserving all other flags and cached contents. It works without Spotify, a prepared profile, or Spicetify, and requires only a small allowance for its recovery record. Blocking still uses the CLI. Changed settings gracefully close Spotify; the upstream Mac command calls `pkill Spotify` even with `--no-restart`. Spicetify's [macOS implementation](https://github.com/spicetify/cli/blob/v2.45.3/src/cmd/block-updates.go) sets or clears the user immutable flag on `~/Library/Application Support/Spotify/PersistentCache/Update`. It doesn't patch the Mac executable. The engine verifies the actual flag and exercises real write and rename attempts because the CLI can report success despite a failed `chflags`. The immutable flag protects directory entries, not existing children or cached app execution. Before Spotify is asked to quit, a nonempty Update folder is moved into the operation's private backup as `pending-spotify-update`; the updater receives an empty locked folder. The native engine applies and verifies the flag before quitting Spotify to prevent a cached-update exit handoff; the subsequent CLI command and post-install checks confirm the final setting. No pending payload is deleted or patched. Setup detection accepts only a locked, empty staging folder. A failure restores the original folder, contents, and exact flags alongside the rest of the setup. `spotify-updates.json` records the original existence, flags, and optional pending-folder recovery location. When manually restoring a quarantined update, unlock the empty active folder, remove it only if empty, move the saved folder back to the recorded original path, and restore its recorded flags. Unblocking allows fresh downloads; it does not automatically requeue old saved updates. The command runs with `HOME` set to the selected account's home. Tests use isolated homes; real-command test harnesses must also substitute a harmless `pkill` in the child command's PATH to avoid closing the user's Spotify.

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

**Update now** uses Sparkle's standard update window. **Install Update**, then
**Install and Relaunch**, verifies the signed archive, replaces the current app,
quits the old process and opens the replacement. Setup actions are disabled during
this session; cancellation and failures return to the current manager. A separate
uninstall is unnecessary: preferences, analytics choices, backups and Tagify files
are outside the app bundle and remain intact. Running from a read-only disk image
requires copying the manager to Applications first. Sparkle handles administrator
authorization only when the destination requires it. Updating the manager and
updating Tagify remain separate actions. No login item or background service is added.

The framework is pinned to Sparkle 2.10.0 with a SHA-256-verified official download
in `prepare-sparkle.sh`. The build embeds it with relative runtime paths, signs its
helpers before signing the framework and app, and notarizes the complete bundle.
**Skip This Version** suppresses the launch prompt for that version; the update
button remains available to reconsider. The signed Mac-only feed is `https://raw.githubusercontent.com/alexk218/tagify-installer/main/appcast.xml`.
Archive signatures are verified before extraction, and the feed itself must be
signed, with unsigned-feed fallback disabled. Losing the signing key requires
restoring its secure backup or a manual upgrade. Sparkle system profiling and unattended downloading/installing are disabled.
The existing GitHub check supplies the launch reminder; the signed feed alone
controls installable updates. `download_manager_update` analytics still measure
only the verified download ready for installation, never claim the replacement launched; the next manager open
records its actual version normally.

### Publishing an automatic-update release

1. Increment both manager versions in `Info.plist`, update `UPDATE_NOTES.txt`, and build with `--notarize`.
2. Run `bash scripts/install/macos/generate-update-feed.sh scripts/install/TagifyInstaller-mac.zip /path/to/staged-feed [previous-appcast.xml]`.
   Keep the existing public feed as the optional third argument on subsequent releases.
   The tool validates the app signature, notarization ticket and matching release
   configuration, then signs the archive and feed with the Keychain account
   `fm.tagify.installer`. Only the public Ed25519 key belongs in source. Back up the
   private signing key securely before moving to another build Mac; never commit it.
3. Upload the notarized artifacts to the matching public GitHub release, verify the
   downloads, then commit the exact generated `appcast.xml` to the **public installer
   repository's** `main` branch. Do not publish the feed before its assets are live.
   Windows-only releases do not change this feed. Feed generation does not publish.
4. Verify an installed older Sparkle-enabled manager through replacement and relaunch.

Manager 1.0.8 is the first published Sparkle-enabled Mac release; 1.0.7 was reserved for
Windows and was never published. Versions 1.0.5 and 1.0.6 cannot replace themselves: users must finish one
manual upgrade (quit the old manager, replace it in Applications, open the new copy).
Existing public artifacts are immutable and have not been replaced by this change.
The signed feed was published with 1.0.8. See [release verification](RELEASE_1.0.8.md).

Run `TAGIFY_UPDATE_QA_DIR=/tmp/tagify-update-qa bash scripts/install/macos/tests/self-update/run.sh`
for isolated real Sparkle replacement/relaunch, cancellation, corrupted archive/feed
and unavailable-server checks. These disposable apps use separate identities,
loopback HTTP and temporary signing keys, never the real manager or production feed.
The normal native UI suite checks the manager's handoff, busy state, deferred retry
and initialization-error recovery. Full administrator authorization requires a
protected installation on a separate test account; writable in-place replacement
is covered by the automated journey.

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

Add `TAGIFY_TEST_DISK_IMAGES=1` to include a disposable 64 MiB mounted volume and a read-only mount. These checks exercise real filesystem capacity and read-only detection, confirm installation stops before mutation, and confirm allowing updates still works on a small drive without Spotify or Spicetify. The harness detaches its mounts afterward; a failed detach preserves the fixture for inspection.

**Logs** and **Check again** are available beside Your setup, matching Windows. Logs opens the diagnostic window before or after installation; Check again refreshes local setup and online update checks without reinstalling. Logs remain available through View details while installation is running.

## Safe updates and interrupted setup

The manager keeps an installed beta on its existing channel and never replaces a newer installed Tagify or Spicetify with an older stable release. **Repair Tagify** reapplies the installed files and versions; a complete local installation can be repaired offline. If Tagify's local files or Spicetify's wrapper are incomplete, repair requests that exact release and stops without replacing it if unavailable. **Update setup** explicitly updates Spicetify while retaining Tagify; **Repair without updating** remains available. Changing release channels is not offered by this workflow.

Spicetify's `Themes`, `Extensions`, and `CustomApps` directories beside its executable are merged. Existing files with no ownership history are preserved. The manager updates a bundled customization only when its content still matches the copy it previously installed. Edited files and additional apps are preserved, including symbolic-link destinations. Runtime files such as `jsHelper` still update with the CLI. The ownership record is included in the installation snapshot.

Every new operation records `operation.json` in its private backup directory before changing the Spotify update setting. The record is written atomically and synchronized. Complete file snapshots include content fingerprints and the install recovery key. Only after the same `SetupStatus.inspect` checks used by the window pass does setup mark the operation committed. These checks establish that installation files and configuration are present and consistent; they do not claim to run Tagify inside Spotify.

On launch, unfinished operations offer **Restore previous setup** and prevent another installation from overwriting the recovery point. Restoration works without an internet connection, takes the account lock, closes Spotify, verifies all saved file copies, and swaps staged copies into place on the destination volume. A missing or damaged backup does not delete the current copy. Interrupted restoration can be retried using the original saved copy. If the user selected another Spotify copy, they must select the original copy before restoring. Backups from older managers without an operation record remain available for manual recovery; their completion state cannot be inferred safely.

The protected targets exclude Spotify user data. Direct symbolic links at protected installation targets are rejected before changes because a link-only snapshot cannot restore its target's contents. The administrator ACL grant remains persistent and is not reversed by file recovery. Filesystem durability still depends on the storage device and operating system; the process-interruption tests do not simulate hardware failure.

The historical Mac `install.sh` entry point now prints the canonical manager download instructions and exits before network requests or setup mutations. Its Linux path remains unchanged. The README points to the installer releases page, where users choose the newest release containing Mac downloads; a Windows-only release cannot make a direct `latest/download` link the recommended Mac path.


## Space, retention, and existing installations

`InstallerMaintenance.swift` checks actual free space on each destination filesystem, including temporary downloads, backups, custom config/state folders, and Spotify. Needs on the same filesystem are combined. Estimates allow full copies for backups, preprocessing, replacement, and staged restoration without relying on APFS clone savings, plus 512 MiB of headroom per volume. Checks run before downloads, before archive extraction, and before installation snapshots. Restoration checks space before closing Spotify or replacing files. Other processes can still consume space afterward, so rollback and saved recovery remain necessary.

Under the account installation lock, retention keeps the newest three completed setup backups and three completed update-setting backups **per Spotify copy**. It runs before a new operation and after successful installation, setting changes, and interrupted-setup recovery. Only records written with the explicit retention version and completion date are eligible. Active operations, old records without those fields, malformed records, linked backup directories, and folders containing unexpected user-added files are preserved. Cleanup does not follow symbolic links. It can clear user immutable flags inside an eligible saved pending update so that completed snapshots do not accumulate forever. A cleanup failure is logged and does not turn a successful install into a failed one. These exceptions deliberately take priority over a strict disk-usage cap.

`InstallerDiscovery.swift` validates the Spotify bundle identifier, executable, and Apps directory, then looks for usable version information in its preferences. This is a prepared-profile check, **not proof of an authenticated Spotify session**. The manager remembers a manually chosen copy, honors a valid configured Spotify/prefs path, considers running and registered copies, and rejects read-only destinations with instructions to move Spotify to Applications. Missing or damaged remembered copies no longer hide another valid installation.

Spicetify discovery checks the existing private runtime, absolute PATH entries, and the standard Intel/Apple Silicon Homebrew locations even when launched from Finder. It resolves executable links to locate matching helpers. Config and state continue to follow Spicetify's macOS defaults and explicit `SPICETIFY_CONFIG`/`SPICETIFY_STATE` overrides; macOS does not use the Linux XDG defaults. Homebrew and other external runtimes are used in place and excluded from writable runtime snapshots. Repair/install retains their versions. Updates or missing runtime files lead to targeted help; no `brew` command is executed automatically and no competing private CLI is installed. The [Homebrew formula](https://github.com/Homebrew/homebrew-core/blob/master/Formula/s/spicetify-cli.rb) owns the executable and helpers in its `libexec` directory.

A healthy external installation keeps **Open Spotify** available when an upstream Spicetify update exists. **Update help** is available in its setup card, so a delay in the package manager's release does not prevent using Tagify.

## Analytics

The manager records usage automatically for new installations, with no opt-in step in setup. Existing saved opt-outs remain off. The manager has no analytics disclosure dialog or sharing controls. Only explicit manager events are sent; there is no autocapture, session recording, background service, or Spotify activity tracking. The installer remains usable without configuration or network access. See [analytics setup and reporting](../analytics/README.md) for the event contract, project configuration, privacy settings, download schedule, dashboard, and verification gates. Windows instrumentation is maintained separately in `alexk218/tagify-installer-dev`; its public release is tracked independently.

Set `TAGIFY_REQUIRE_ANALYTICS=1` for an analytics-enabled release build so a missing project token fails the build. A development build without configuration does not send analytics. The bundled token is a public project ingestion token; never embed a personal API key. `test:installer:mac` includes the dependency-free Node reporting tests and native defaults/opt-out/queue/UI coverage, using fake transports and disposable homes.

Updated Tagify builds include `productAnalyticsBridge.js`. Manager can replace it before apply with a seven-day historical setup offer when Manager sharing is enabled. New unset Tagify accounts can link a version-two offer automatically; older offers retain their prior permission requirements; Manager opt-out does not change the independent app sharing choice or immediately update applied copies. Missing/invalid manifests, older clients and bridge-write failures skip linking without blocking setup.

The current Mac release is 1.0.9. Download links at `https://tagify.fm/download/mac` and `https://tagify.fm/download/windows` resolve the newest stable release with the appropriate platform asset independently, with up to five minutes of CDN caching. The signed Mac feed contains only the current supported release. See [1.0.9 verification](RELEASE_1.0.9.md).
