# Mac Manager 1.0.9 verification

Published October 11, 2026: https://github.com/alexk218/tagify-installer/releases/tag/v1.0.9

Built from installer source in canonical commit `8477ea31`, version 1.0.9, build 10. The release removes the analytics disclosure button, dialog and checkbox. Existing tracking and saved preferences are unchanged. The higher version preserves upgrade eligibility for installed 1.0.8 copies; retired release numbers are not reused.

## Artifacts

| File | SHA-256 |
| --- | --- |
| TagifyInstaller-mac.dmg | `412a6339e0699f531e9d164bb8b63bf8a8ef346cf32a1f51d77990f0cbe5d446` |
| TagifyInstaller-mac.zip | `b51934e50f4130720ffd986ff9441ee934ceda294fdc08d7e4f730fa5765bfc9` |
| Tagify.pkg | `d2938638ae9581019bb34e2d46b02c0220076cdee0764c2b094d01947088c154` |

The universal Intel/Apple Silicon app and packages passed signature verification and Apple notarization. Downloaded draft and public assets match the local checksums. The app's stapled ticket validates. Signed feed publication commit: `f0fabf0d2507df7a3aee90d05faab6996db6e75e`.

## Verification

- UI removal validation: 519 native core assertions, 101 native UI assertions, 12 reporting tests; normal and small-window captures inspected.
- Release-cycle real Sparkle scenarios: success, cancellation, corrupt archive, corrupt feed and unavailable server all passed.
- Public feed upgrade of an isolated published 1.0.8 app: process 89814 exited; process 89929 relaunched the replaced app at the same path, displaying 1.0.9. No analytics controls appear. Real Spotify setup was not modified by the manager test. Protected administrator-only replacement remains outside this test.
- Website: 17 tests cover platform detection, stable semantic-version selection, mixed-platform releases, missing/foreign assets, pagination, invalid requests and outages. Seven client help-link tests passed.
- Live website production deployment `dpl_4duUQSYeDDbg8KfZ54EwCAgwA9qS`, website commit `b97d0a2d37c847dcd06465943754ecac91913305`. A first deployment failed because it attempted the old Spotify app dependency install; the website is now dependency-free and separately configured. No app runtime dependencies were changed.
- Live Mac route selects 1.0.9; Windows selects 1.0.5. Responses cache for five minutes. API outages fall back to the release list rather than the shared latest-release asset. `/releases/latest` remains 1.0.5 for older Windows managers.
- The updated client help link was installed locally as Tagify 3.1.0; `spicetify apply` passed. Backup: `/Users/alexkepekci/.config/spicetify/CustomApps/tagify.backup-20261011-182711`.

Evidence and preserved retired-release metadata/download counts: `/tmp/tagify-manager-109-release`. Historical verification notes describe the releases as tested at the time; they do not imply continued public availability.

## Retired releases

At Alex's request, public Mac releases 1.0.6 and 1.0.8 are retired after 1.0.9 verification and download-cache expiry. Git tags and local verification archives remain preserved. There was no published 1.0.7 release to delete. Windows 1.0.5 remains available and retains GitHub's shared Latest designation.

Before retirement, the recorded 1.0.6 asset counts were DMG 3, ZIP 1, PKG 1; 1.0.8 counts were DMG 2, ZIP 4, PKG 3. These include owner verification downloads and are not unique-user counts. Additional archive downloads made during retirement are also verification traffic. Deleting a GitHub release removes its assets from future API download snapshots; the saved receipt retains this historical baseline.
