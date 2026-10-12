# Mac Manager 1.0.8 release verification

Published October 11, 2026: https://github.com/alexk218/tagify-installer/releases/tag/v1.0.8

Canonical source: `c09bd4f59f11c2865967a60dfc21a10cf5566d63`, `packages/tagify-secret/scripts/install`. Version **1.0.8**, build **9**. Built from a clean Git archive with required analytics configuration, Developer ID signing and Apple notarization. This includes Sparkle updates, automatic Manager analytics preserving saved opt-outs, the version-two historical app handoff, and the latest sharing explanation. Windows was not rebuilt or changed.

## Published artifacts

| Asset | SHA-256 |
| --- | --- |
| TagifyInstaller-mac.dmg | `be575694edfb61ae0a471bbed34591c5bd89b6f2196970606f176406e2faff60` |
| TagifyInstaller-mac.zip | `40d0c3b0bc4cd8edd659258b679b9a83e6277c419d26005175ab89e98404dd15` |
| Tagify.pkg | `99564468c79272ee1deeb51d28c86238e1330bfc41189a6a516d25db0e200625` |

All artifacts were downloaded from the unauthenticated public release URLs and matched the staged checksums and published `SHA256SUMS`. The universal app contains arm64 and x86_64 binaries. Strict deep signature verification, Gatekeeper assessment, notarization ticket validation and package signature verification passed. Application and Installer identities use Apple team `B398A55P8F`.

Apple accepted app submission `9930983e-cedb-4c16-8141-2bd74d89b064`, DMG `84b25ef5-8c16-4dd9-9894-c6513dfd661c`, and PKG `8923d22e-1007-428c-90cc-75cf1391498a`. The tracked `scripts/install/Tagify.pkg` now matches this published package; older release assets were not replaced.

The signed Mac-only feed is https://raw.githubusercontent.com/alexk218/tagify-installer/main/appcast.xml, published in public-repository commit `f384034fc85d4d73b9112bb5fa464d6eee2496b6` **after** the public downloads passed checksum verification. Its downloaded bytes and signature match the staged feed, and its enclosure points to the verified 1.0.8 ZIP.

This release uses `latest=false`. GitHub `/releases/latest` remains 1.0.5 for existing Windows managers; Mac discovery and Sparkle use their own platform-specific paths.

## Verification

- `TAGIFY_TEST_DISK_IMAGES=1 TAGIFY_TEST_REAL_SPICETIFY=/Users/alexkepekci/.spicetify/spicetify TAGIFY_INSTALLER_QA_DIR=/tmp/tagify-manager-108-release-20261011/native-qa npm run test:installer:mac --workspace=tagify-secret`: **521 core, 101 native UI and 12 reporting checks passed**, plus the historical terminal-entry check. Includes real low-space/read-only mounted volumes and isolated real Spicetify update protection.
- `TAGIFY_UPDATE_QA_DIR=/tmp/tagify-manager-108-release-20261011/sparkle-qa bash scripts/install/macos/tests/self-update/run.sh`: all five real Sparkle journeys passed (replacement/relaunch, cancellation, corrupt archive, corrupt feed, unavailable server).
- Before publication, a disposable signed older-version fixture installed the **actual release ZIP** from a locally signed test feed. It replaced the same app path, exited PID 60087 and relaunched PID 60137 as 1.0.8. Saved preferences were byte-identical. The fixture was derived from the current Sparkle-enabled source, not the historical 1.0.4 release.
- After publication, another signed older-version fixture downloaded through the **live public feed**, reached Install and Relaunch, exited PID 61446 and reopened PID 61553 at the same path as 1.0.8. Its binary matches the staged release, deep signature verification passes, and the native window shows the existing Tagify 3.1.0 setup as ready. No Tagify reinstall was run.
- Two extra live-feed attempts using `CFFIXED_USER_HOME` stalled after verified extraction. Their logs are retained. Repeating without the home override passed; do not use that override as a representative Sparkle helper test environment. The normal-account check preserved its existing analytics opt-out. Writable replacement was tested; administrator-protected replacement still needs a separate test account.

Managers 1.0.5/1.0.6 need one manual replacement to acquire Sparkle; no test here claims those historical binaries can replace themselves. The release notes provide the manual migration instructions.

## Live analytics

The signed, unmodified release app was launched with a fresh isolated analytics home and no saved choice. PostHog project **659103** received two genuine `installer_opened` events for verification installation `2C2D9F0D-4BF9-403D-9C48-56F7E9F17032`:

- `2026-10-11T21:52:18Z`, event `3682b063-8ef8-4a28-99ed-20df20310768`, first observed open true.
- `2026-10-11T21:52:45Z`, event `84986dbb-9ce4-4330-ba28-cf9bf13ea997`, first observed open false, same installation ID and a different session ID.

Both report installer 1.0.8, disable geolocation/person profiles, and contain no IP address. The project also has IP discarding enabled. Turning sharing off through the actual native dialog cleared the identity and pending queue. Relaunch preserved the disabled state and querying ingestion still returned exactly the two prior opens. These owner verification events are not customer adoption; no simulated setup-success events were uploaded to production.

Native tests verify the version-two historical handoff and failure/operation instrumentation. The preceding combined client verification is documented in the product analytics guide; this installer publication does not separately publish the Tagify client.

Local evidence: `/tmp/tagify-manager-108-release-20261011` contains frozen source, build/notarization logs, signatures, feeds, regression/UI results, update diagnostics, and downloaded release copies. No hosted build ran for this release.
