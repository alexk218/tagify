import Foundation
import Darwin

func runTests() throws {
    try testUpdateProtection()
    let fresh = try Fixture(fresh: true)
    try expect(try fresh.installer.install(architecture: "arm64") == "3.0.0", "Fresh install failed")
    try expect(fresh.closed, "Spotify wasn't closed")
    try expect(fresh.spiceCommands.contains(["--no-restart", "backup", "apply"]), "Fresh install didn't apply")
    try expect(fresh.spiceCommands.last == ["--no-restart", "spotify-updates", "block"], "Spotify updates weren't blocked by default")
    try expect(try SpotifyUpdateState.directoryFlags(fresh.paths.spotifyUpdates)! & UInt32(UF_IMMUTABLE) != 0, "Update folder wasn't locked")
    try expect(text(fresh.paths.key).trimmingCharacters(in: .newlines).count == 56, "Recovery key missing")
    try expect((try files.attributesOfItem(atPath: fresh.paths.key.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Recovery key isn't private")
    try expect(text(fresh.paths.tagify.appendingPathComponent("extension.js")).hasPrefix("globalThis.__tagifyInstallRecoveryKey="), "Recovery bootstrap missing")
    try expect(text(fresh.paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js")) == "Matching wrapper", "Spicetify helpers missing")

    let existing = try Fixture(backupMatches: true)
    let originalKey = text(existing.paths.key)
    _ = try existing.installer.install(architecture: "arm64")
    try expect(existing.spiceCommands.contains(["--no-restart", "restore", "backup", "apply"]), "CLI update didn't reprocess matching backup")
    try expect(text(existing.paths.key) == originalKey, "Reinstall replaced recovery identity")
    try expect(text(existing.paths.config.appendingPathComponent("config-xpui.ini")).contains("custom_apps=marketplace|other|tagify"), "Existing custom apps lost")
    try expect(text(existing.paths.config.appendingPathComponent("Themes/custom/user.css")) == "My theme", "Existing theme lost")
    try expect(text(existing.paths.config.appendingPathComponent("CustomApps/other/index.js")) == "Other app", "Existing custom app lost")
    try expect(text(existing.paths.home.appendingPathComponent("Library/Application Support/Spotify/PersistentCache/library.json")) == "{\"dateModified\":12345,\"tags\":[\"Keep me\"]}", "User library changed")
    try expect(existing.installer.backupURL != nil, "Backup unavailable")
    // Idempotent rerun still applies even when Tagify is already present in the config.
    _ = try existing.installer.install(architecture: "arm64")
    try expect(existing.spiceCommands.filter { $0.contains("apply") }.count == 2, "Reinstall skipped apply")
    try expect(!text(existing.installer.logURL).contains(originalKey.trimmingCharacters(in: .newlines)), "Recovery key leaked to log")
    _ = try existing.installer.install(architecture: "arm64", blockSpotifyUpdates: false)
    try expect(existing.spiceCommands.last == ["--no-restart", "spotify-updates", "unblock"], "Unchecking didn't use Spicetify unblock")
    try expect(try SpotifyUpdateState.directoryFlags(existing.paths.spotifyUpdates)! & UInt32(UF_IMMUTABLE) == 0, "Unchecking didn't unlock the update folder")

    let updateFailure = try Fixture()
    try put(updateFailure.paths.spotifyUpdates.appendingPathComponent("pending-update"), "Preserve cached update")
    try expect(chflags(updateFailure.paths.spotifyUpdates.path, UInt32(UF_NODUMP)) == 0, "Couldn't set initial update flags")
    updateFailure.failUpdateSetting = true
    try fails("Failed update block accepted") { _ = try updateFailure.installer.install(architecture: "arm64") }
    try expect(try SpotifyUpdateState.directoryFlags(updateFailure.paths.spotifyUpdates) == UInt32(UF_NODUMP), "Previous update flags weren't restored")
    try expect(text(updateFailure.paths.spotifyUpdates.appendingPathComponent("pending-update")) == "Preserve cached update", "Update rollback changed cached files")
    try expect(text(updateFailure.paths.resources.appendingPathComponent("Apps/xpui/original.js")) == "Original Spotify", "Update failure didn't restore Spotify")
    try expect(text(updateFailure.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Update failure didn't restore Tagify")
    try expect(files.fileExists(atPath: updateFailure.installer.backupURL!.appendingPathComponent("spotify-updates.json").path), "Update recovery information wasn't saved")

    let noUpdateFolder = try Fixture()
    noUpdateFolder.failUpdateSetting = true
    try fails("Failed new update block accepted") { _ = try noUpdateFolder.installer.install(architecture: "arm64") }
    try expect(!files.fileExists(atPath: noUpdateFolder.paths.spotifyUpdates.path), "Failed setup left a newly locked update folder")
    let silentUpdateFailure = try Fixture()
    _ = try silentUpdateFailure.installer.install(architecture: "arm64")
    silentUpdateFailure.ignoreUpdateSetting = true
    try fails("CLI success without actually allowing updates accepted") { _ = try silentUpdateFailure.installer.install(architecture: "arm64", blockSpotifyUpdates: false) }
    try expect(SpotifyUpdateState.isBlocked(silentUpdateFailure.paths.spotifyUpdates), "Silent unblock failure didn't restore protection")

    let failedUnblock = try Fixture()
    _ = try failedUnblock.installer.install(architecture: "arm64")
    failedUnblock.failUpdateSetting = true
    try fails("Failed unblock accepted") { _ = try failedUnblock.installer.install(architecture: "arm64", blockSpotifyUpdates: false) }
    try expect(try SpotifyUpdateState.directoryFlags(failedUnblock.paths.spotifyUpdates)! & UInt32(UF_IMMUTABLE) != 0, "Failed unblock didn't restore the prior block")

    let updatedSpotify = try Fixture()
    _ = try updatedSpotify.installer.install(architecture: "arm64")
    try expect(updatedSpotify.spiceCommands.contains(["--no-restart", "backup", "apply"]), "Stale Spotify backup was restored")
    let customState = try Fixture(backupMatches: true)
    try files.moveItem(at: customState.paths.state.appendingPathComponent("Backup/xpui.spa"), to: customState.paths.state.appendingPathComponent("xpui.spa"))
    _ = try customState.installer.install(architecture: "arm64")
    try expect(customState.spiceCommands.contains(["--no-restart", "restore", "backup", "apply"]), "Exact state override backup wasn't recognized")
    let normalPaths = InstallerPaths(spotify: URL(fileURLWithPath: "/Applications/Spotify.app"), environment: [:])
    try expect(normalPaths.stateOverride == nil, "Default state was converted into an explicit override")
    let failed = try Fixture()
    failed.failApply = true
    try fails("Apply failure reported success") { _ = try failed.installer.install(architecture: "arm64") }
    try expect(text(failed.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Old Tagify not restored")
    try expect(text(failed.paths.binary) == "Old binary", "Old Spicetify not restored")
    try expect(text(failed.paths.resources.appendingPathComponent("Apps/xpui/original.js")) == "Original Spotify", "Spotify not restored")
    try expect(text(failed.paths.state.appendingPathComponent("Backup/xpui.spa")) == "Previous backup", "Spicetify state not restored")
    try expect(!text(failed.paths.config.appendingPathComponent("config-xpui.ini")).contains("|tagify"), "Config not restored")
    failed.failApply = false
    _ = try failed.installer.install(architecture: "arm64")
    try expect(text(failed.paths.tagify.appendingPathComponent("extension.js")).contains("New extension.js"), "Retry after failure didn't work")

    let invalid = try Fixture()
    invalid.corrupt = true
    try fails("Bad checksum accepted") { _ = try invalid.installer.install(architecture: "arm64") }
    try expect(!invalid.closed && invalid.installer.backupURL == nil, "Bad download changed setup")
    try expect(text(invalid.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Bad download removed previous Tagify")
    let unconfirmed = try Fixture()
    unconfirmed.omitAppliedFiles = true
    try fails("Missing applied files accepted") { _ = try unconfirmed.installer.install(architecture: "arm64") }
    try expect(text(unconfirmed.paths.resources.appendingPathComponent("Apps/xpui/original.js")) == "Original Spotify", "Verification failure didn't restore Spotify")
    let unsignedIn = try Fixture()
    try files.removeItem(at: unsignedIn.paths.prefs)
    try fails("Missing Spotify sign-in accepted") { _ = try unsignedIn.installer.install(architecture: "arm64") }
    try expect(!unsignedIn.closed, "Missing sign-in changed setup")

    try fails("Parent traversal accepted") { try TagifyInstaller.validateArchiveListing(names: "tagify/../../outside", details: "-rw-r--r-- file") }
    try fails("Absolute path accepted") { try TagifyInstaller.validateArchiveListing(names: "/outside", details: "-rw-r--r-- file") }
    try fails("Symlink accepted") { try TagifyInstaller.validateArchiveListing(names: "tagify/link", details: "lrwxrwxrwx link") }
    try fails("Hardlink accepted") { try TagifyInstaller.validateArchiveListing(names: "tagify/link", details: "hrwxrwxrwx link") }
    try TagifyInstaller.validateArchiveListing(names: "tagify/\ntagify/extension.js", details: "drwxr-xr-x tagify/\n-rw-r--r-- tagify/extension.js")
    let invalidRelease = "{\"tag_name\":\"v3.0.0\",\"draft\":false,\"prerelease\":false,\"assets\":[{\"name\":\"tagify-v3.0.0.zip\",\"browser_download_url\":\"https://other.example/evil.zip\",\"digest\":\"sha256:\(String(repeating: "a", count: 64))\"}]}"
    let release = try JSONDecoder().decode(Release.self, from: Data(invalidRelease.utf8))
    try fails("Untrusted asset accepted") { _ = try release.asset(repository: "alexk218/tagify", architecture: "arm64") }
    let locked = try Fixture()
    try files.createDirectory(at: locked.paths.backups, withIntermediateDirectories: true)
    let lock = Darwin.open(locked.paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
    flock(lock, LOCK_EX)
    defer { flock(lock, LOCK_UN); Darwin.close(lock) }
    try fails("Concurrent install accepted") { _ = try locked.installer.install(architecture: "arm64") }
    try expect(!locked.closed, "Concurrent installer closed Spotify")

    let healthy = SetupStatus.inspect(paths: fresh.paths)
    try expect(healthy.needsSpicetifyUpdate(latest: "2.45.4") && !healthy.needsSpicetifyUpdate(latest: "2.45.3") && !healthy.needsSpicetifyUpdate(latest: "2.44.0"), "Spicetify update or downgrade comparison is wrong")
    try expect(healthy.ready && healthy.tagifyVersion == "3.0.0" && healthy.spicetifyVersion == "2.45.3", "Verified installation wasn't recognized as ready")
    try expect(healthy.updatesBlocked == true && !healthy.needsTagifyUpdate(latest: "2.9.9"), "Healthy protection or version comparison is wrong")
    try expect(healthy.needsTagifyUpdate(latest: "3.0.1"), "A newer Tagify release wasn't recognized")
    try files.removeItem(at: fresh.paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"))
    try expect(!SetupStatus.inspect(paths: fresh.paths).ready, "Missing Spotify app files were considered healthy")
    try put(fresh.paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"), "Route restored")
    let freshConfig = fresh.paths.config.appendingPathComponent("config-xpui.ini")
    let savedConfig = text(freshConfig)
    try put(freshConfig, savedConfig + "\n[Backup]\nversion=1.0.0\n")
    try expect(!SetupStatus.inspect(paths: fresh.paths).ready, "Spotify update wasn't detected despite a stale applied version")
    try put(freshConfig, savedConfig + "\n[Setting]\nspotify_path=/different/Spotify.app/Contents/Resources\n")
    try expect(!SetupStatus.inspect(paths: fresh.paths).ready, "A different configured Spotify copy was considered healthy")
    try put(freshConfig, savedConfig)
    let binaryFailure = SetupStatus.inspect(paths: fresh.paths, command: { _, _, _ in CommandResult(status: 1, output: "broken") })
    try expect(!binaryFailure.ready && binaryFailure.spicetifyVersion == nil, "Broken Spicetify was considered ready")

    let settingOnly = try Fixture(fresh: true)
    _ = try settingOnly.installer.install(architecture: "arm64")
    settingOnly.closed = false
    let installedCommands = settingOnly.spiceCommands.count
    let installedTagify = text(settingOnly.paths.tagify.appendingPathComponent("extension.js"))
    let installedSpotify = text(settingOnly.paths.resources.appendingPathComponent("Apps/xpui/original.js"))
    try settingOnly.installer.applySpotifyUpdateSetting(blocked: true)
    try expect(!settingOnly.closed && settingOnly.spiceCommands.count == installedCommands, "Unchanged protection closed Spotify or reran commands")
    try settingOnly.installer.applySpotifyUpdateSetting(blocked: false)
    try expect(settingOnly.closed && settingOnly.spiceCommands.count == installedCommands + 1, "Changing protection reinstalled Tagify or failed to close Spotify gracefully")
    try expect(settingOnly.spiceCommands.last == ["--no-restart", "spotify-updates", "unblock"], "Separate setting didn't unblock Spotify")
    try expect(text(settingOnly.paths.tagify.appendingPathComponent("extension.js")) == installedTagify && text(settingOnly.paths.resources.appendingPathComponent("Apps/xpui/original.js")) == installedSpotify, "Setting-only operation replaced Tagify or Spotify files")
    settingOnly.failUpdateSetting = true
    try fails("Setting-only failure accepted") { try settingOnly.installer.applySpotifyUpdateSetting(blocked: true) }
    try expect(try SpotifyUpdateState.directoryFlags(settingOnly.paths.spotifyUpdates)! & UInt32(UF_IMMUTABLE) == 0, "Setting-only failure didn't restore prior flags")
    settingOnly.failUpdateSetting = false
    try settingOnly.installer.applySpotifyUpdateSetting(blocked: true)
    try expect(try SpotifyUpdateState.directoryFlags(settingOnly.paths.spotifyUpdates)! & UInt32(UF_IMMUTABLE) != 0, "Setting retry failed")
    let settingLock = Darwin.open(settingOnly.paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
    flock(settingLock, LOCK_EX)
    try fails("Concurrent setting operation accepted") { try settingOnly.installer.applySpotifyUpdateSetting(blocked: false) }
    flock(settingLock, LOCK_UN); Darwin.close(settingLock)
    let unsafe = try Fixture(fresh: true)
    try files.createDirectory(at: unsafe.paths.spotifyUpdates.deletingLastPathComponent(), withIntermediateDirectories: true)
    try files.createSymbolicLink(at: unsafe.paths.spotifyUpdates, withDestinationURL: unsafe.root)
    try expect(SetupStatus.inspect(paths: unsafe.paths).updatesBlocked == nil, "An unsafe update folder was reported as protected")

    var choices = try InstallerPreferences.load(home: fresh.paths.home)
    try expect(!choices.tutorialCompleted && choices.blockSpotifyUpdates == nil, "First-run preferences aren't empty")
    choices.blockSpotifyUpdates = false; choices.tutorialCompleted = true
    try choices.save(home: fresh.paths.home)
    let remembered = try InstallerPreferences.load(home: fresh.paths.home)
    try expect(remembered.tutorialCompleted && remembered.blockSpotifyUpdates == false, "Tutorial completion or opted-out protection was lost")
    try expect((try files.attributesOfItem(atPath: InstallerPreferences.location(home: fresh.paths.home).path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Installer choices aren't private")
    try put(InstallerPreferences.location(home: fresh.paths.home), "corrupt choices")
    try fails("Corrupt choices were silently replaced") { _ = try InstallerPreferences.load(home: fresh.paths.home) }
    try expect(text(InstallerPreferences.location(home: fresh.paths.home)) == "corrupt choices", "Reading damaged choices overwrote the file")

    try expect(StableVersion("v1.0.10")! > StableVersion("1.0.9")!, "Versions compared as text instead of numbers")
    try expect(StableVersion("v1.0.1") == StableVersion("1.0.1"), "Version prefix changed equality")
    for invalid in ["1.0.2-beta", "latest", "01.0.1", "v1.0", "999999999999999999999.0.0"] {
        try expect(StableVersion(invalid) == nil, "Invalid version accepted: \(invalid)")
    }
    func macRelease(_ tag: String, name: String = "TagifyInstaller-mac.dmg", url: String? = nil, hash: String? = nil, prerelease: Bool = false, draft: Bool = false) -> InstallerRelease {
        InstallerRelease(tag_name: tag, draft: draft, prerelease: prerelease, body: "A useful update", assets: [InstallerRelease.Asset(name: name, browser_download_url: URL(string: url ?? "https://github.com/alexk218/tagify-installer/releases/download/\(tag)/\(name)")!, digest: hash ?? "sha256:" + String(repeating: "a", count: 64))])
    }
    let mac = macRelease("v1.0.2")
    let newerWindows = macRelease("v1.0.9", name: "Tagify Manager.exe")
    try expect(InstallerUpdates.select([newerWindows, mac], installed: "1.0.1")?.version.string == "1.0.2", "Windows-only release hid or replaced a Mac update")
    try expect(InstallerUpdates.select([mac], installed: "1.0.2") == nil && InstallerUpdates.select([mac], installed: "1.0.3") == nil, "Current installer or a downgrade was offered")
    for candidate in [macRelease("v1.0.3", prerelease: true), macRelease("v1.0.3", draft: true), macRelease("v1.0.3-beta"), macRelease("v1.0.3", hash: ""), macRelease("v1.0.3", url: "https://github.com/other/repo/releases/download/v1.0.3/TagifyInstaller-mac.dmg"), macRelease("v1.0.3", url: "https://github.com/alexk218/tagify-installer/releases/download/v1.0.3/TagifyInstaller-mac.dmg?redirect=bad")] {
        try expect(InstallerUpdates.select([candidate], installed: "1.0.1") == nil, "Untrusted or unstable Mac update was offered")
    }
    try expect(InstallerUpdates.select([macRelease("v1.0.3", name: "TagifyInstaller-mac.zip")], installed: "1.0.1") != nil, "Mac ZIP fallback wasn't supported")
    try expect(InstallerUpdates.select([mac, macRelease("v1.0.10")], installed: "1.0.1")?.version.string == "1.0.10", "Newest stable Mac update wasn't selected")
    let updateSource = fresh.root.appendingPathComponent("installer.dmg")
    try put(updateSource, "Verified installer download")
    let validUpdate = InstallerUpdate(version: StableVersion("1.0.2")!, notes: "Notes", asset: InstallerRelease.Asset(name: mac.assets[0].name, browser_download_url: mac.assets[0].browser_download_url, digest: try digest(updateSource)))
    let downloads = fresh.paths.home.appendingPathComponent("Downloads")
    let originalDownload = downloads.appendingPathComponent("TagifyInstaller-mac-1.0.2.dmg")
    try put(originalDownload, "Keep my old download")
    let downloaded = try InstallerUpdates.download(validUpdate, downloads: downloads, transfer: { _, target in try files.copyItem(at: updateSource, to: target) })
    try expect(downloaded != originalDownload && text(originalDownload) == "Keep my old download" && text(downloaded) == "Verified installer download", "Update download overwrote an existing file or saved unverified content")
    try fails("Corrupt installer update accepted") { _ = try InstallerUpdates.download(validUpdate, downloads: downloads, transfer: { _, target in try put(target, "Wrong content") }) }
    try expect(try files.contentsOfDirectory(at: downloads, includingPropertiesForKeys: nil).count == 2, "Corrupt update left a file in Downloads")
    var reportedSteps: [Int] = []
    var liveLogs = ""
    let staged = try Fixture(fresh: true)
    staged.installer.progress = { step, _ in reportedSteps.append(step) }
    staged.installer.diagnostic = { liveLogs += $0 }
    _ = try staged.installer.install(architecture: "arm64")
    try expect(Set(reportedSteps) == Set(0...6) && reportedSteps.last == 6, "Progress didn't reflect all verified installation stages")
    try expect(liveLogs.contains("RESULT: SUCCESS") && !liveLogs.contains(text(staged.paths.key).trimmingCharacters(in: .newlines)), "Live diagnostic output omitted results or exposed the recovery key")
    print("Passed \(assertions) Mac installer assertions: fresh install, reinstall, setup detection, update-only changes, tutorial preferences, Mac release checks, verified downloads, retries, rollback, data preservation, archive safety, and concurrency.")
}

do { try runTests() }
catch { fputs("FAIL: \(error.localizedDescription)\n", stderr); exit(1) }
