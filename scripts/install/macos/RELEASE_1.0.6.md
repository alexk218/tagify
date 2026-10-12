# Mac Manager 1.0.6 release verification

Published October 11, 2026: https://github.com/alexk218/tagify-installer/releases/tag/v1.0.6

Canonical source: `9289836998a188b85b6777c55490bd19c3ad07ce`, `packages/tagify-secret/scripts/install`. Version 1.0.6, build 7. Built from a clean archive of this commit with `TAGIFY_REQUIRE_ANALYTICS=1` and `npm run build:installer:mac --workspace=tagify-secret -- --notarize`. Later source changes, including the optional Tagify app analytics handoff, are **not** in these artifacts and require a future release.

The universal app includes Intel and Apple Silicon binaries. The app, DMG and PKG passed Apple notarization and ticket stapling. Developer ID Application and Installer certificates belong to Alexander Kepekci, team `B398A55P8F`. Gatekeeper accepted the downloaded public app as Notarized Developer ID; strict deep signature verification, archive integrity and downloaded asset checksums passed.

| Asset | SHA-256 |
| --- | --- |
| TagifyInstaller-mac.dmg | `7ce856cd9111e504e7a9333a1aeb6e3822429621cfc43a9307d8cd7f5e24226f` |
| TagifyInstaller-mac.zip | `40c77e6c568cde846d45ce1a8efec9bb1d44d446e6c5ea51dd7f396dea88e465` |
| Tagify.pkg | `f7ad4f14f0c89b70db7abfa915826e873103b1c233cbcc521a257f5aa8397d13` |

The tracked `scripts/install/Tagify.pkg` is this published signed package. Rebuilding from newer source may produce a different package; do not replace public 1.0.6 assets with it.

## Acceptance evidence

- `TAGIFY_TEST_DISK_IMAGES=1 TAGIFY_TEST_REAL_SPICETIFY=/Users/alexkepekci/.spicetify/spicetify TAGIFY_INSTALLER_QA_DIR=/tmp/tagify-mac-release-qa npm run test:installer:mac --workspace=tagify-secret`: 508 core, 96 native UI and 12 Node checks passed. Includes mounted low-space/read-only filesystems and isolated real Spicetify update-protection checks.
- Public release assets were downloaded again and compared with `SHA256SUMS`; the actual downloaded ZIP app was opened and visually inspected.
- Default-off consent produced no analytics. Opting in sent a real `installer_opened` event to PostHog project 659103 at 20:42:45 UTC. Relaunch at 20:43:12 retained the installation ID, used a new session and reported `first_observed_open=false`.
- PostHog stored exactly two distinct events for this verification installation, with no IP address, geolocation enrichment or person profile. Turning sharing off cleared the local identity/queue; relaunching with sharing off produced no third event. Sharing was left off on the verification Mac.
- No synthetic installation-success events were injected into production. Setup/repair failures, recovery and operation instrumentation were exercised by the isolated native suite. This release does not imply a real Spotify auto-update A/B acceptance test.
- All 12 installer dashboard insights execute. Daily download reporting for both platforms is active; its verified workflow run is https://github.com/alexk218/tagify-monorepo/actions/runs/38172779987 . The new release assets receive their first baseline on the next scheduled collection.

This Mac-only release deliberately uses `latest=false`. Mac managers scan releases for a Mac asset; existing Windows managers use `/releases/latest`. The default latest release remains 1.0.5 so Windows users are not offered a Mac-only update. No Windows executable was replaced.
