import Foundation
import Darwin

func testMaintenance() throws {
    let empty = try Fixture()
    try put(empty.paths.prefs, "")
    try expect(!SetupStatus.inspect(paths: empty.paths).spotifyPrepared, "Empty prefs accepted as a prepared Spotify profile")
    try fails("Empty Spotify profile was installed into") { _ = try empty.installer.install(architecture: "arm64") }
    try expect(!empty.closed && empty.installer.backupURL == nil, "Unprepared Spotify was changed")
    try put(empty.paths.prefs, "unrelated.setting=true\n")
    try expect(!InstallerDiscovery.spotifyPrepared(empty.paths.prefs), "Unrelated preferences accepted")
    try put(empty.paths.prefs, "app.last-launched-version=\"1.2.85.519.g1234\"\n")
    try expect(InstallerDiscovery.spotifyPrepared(empty.paths.prefs), "Real Spotify version suffix rejected")

    let customPrefs = empty.root.appendingPathComponent("custom profile/prefs")
    try put(customPrefs, text(empty.paths.prefs))
    try put(empty.paths.config.appendingPathComponent("config-xpui.ini"), "[Setting]\nprefs_path=\(customPrefs.path)\nspotify_path=\(empty.paths.resources.path)\n")
    let custom = InstallerPaths(home: empty.paths.home, spotify: empty.paths.spotify, environment: [:])
    try expect(custom.prefs.path == customPrefs.path && SetupStatus.inspect(paths: custom).spotifyPrepared, "Configured prefs were ignored")
    let override = InstallerPaths(home: empty.paths.home, spotify: empty.paths.spotify, environment: ["SPICETIFY_CONFIG": "$HOME/custom config", "SPICETIFY_STATE": "~/custom state"])
    try expect(override.config.path == empty.paths.home.appendingPathComponent("custom config").path && override.stateOverride == empty.paths.home.appendingPathComponent("custom state").path, "Custom paths were not expanded consistently")
    let damaged = empty.root.appendingPathComponent("Damaged Spotify.app")
    try files.copyItem(at: empty.paths.spotify, to: damaged)
    try files.removeItem(at: damaged.appendingPathComponent("Contents/MacOS/Spotify"))
    try expect(!InstallerDiscovery.spotifyApp(damaged), "Bundle ID alone identified a damaged Spotify app")
    let selected = InstallerDiscovery.findSpotify(home: empty.paths.home, config: custom.config, preferred: damaged.path)
    try expect(selected?.path == empty.paths.spotify.path, "Stale selection hid the valid configured Spotify copy")
    let second = empty.root.appendingPathComponent("My Spotify.app")
    try files.copyItem(at: empty.paths.spotify, to: second)
    try expect(InstallerDiscovery.findSpotify(home: empty.paths.home, config: custom.config, preferred: second.path)?.path == second.path, "Remembered choice lost to another installed copy")

    let brew = try Fixture()
    try files.removeItem(at: brew.paths.binary)
    let runtime = brew.root.appendingPathComponent("homebrew/Cellar/spicetify-cli/2.45.3/libexec")
    try files.createDirectory(at: runtime.deletingLastPathComponent(), withIntermediateDirectories: true)
    try files.copyItem(at: brew.root.appendingPathComponent("spice-source"), to: runtime)
    let link = brew.root.appendingPathComponent("homebrew/bin/spicetify")
    try files.createDirectory(at: link.deletingLastPathComponent(), withIntermediateDirectories: true)
    try files.createSymbolicLink(at: link, withDestinationURL: runtime.appendingPathComponent("spicetify"))
    let brewPaths = InstallerPaths(home: brew.paths.home, spotify: brew.paths.spotify, environment: ["PATH": link.deletingLastPathComponent().path])
    try expect(brewPaths.spicetifySource == .homebrew && brewPaths.binary.resolvingSymlinksInPath() == runtime.appendingPathComponent("spicetify").resolvingSymlinksInPath(), "Homebrew link wasn't resolved to its matching helpers")
    try expect(!brewPaths.protectedPaths.contains(runtime), "Homebrew runtime was included in writable snapshot targets")
    let external = try TagifyInstaller(paths: brewPaths)
    external.command = { executable, args, env in try brew.installer.command(executable == brewPaths.binary ? brew.paths.binary : executable, args, env) }
    external.closeSpotify = { brew.closed = true }
    external.download = { url, target in
        try expect(!url.path.contains("spicetify/cli"), "Homebrew CLI was replaced with a downloaded distribution")
        try brew.installer.download(url, target)
    }
    let runtimeHash = try InstallerFiles.hash(runtime)
    _ = try external.install(architecture: "arm64")
    try expect(try InstallerFiles.hash(runtime) == runtimeHash && !InstallerFiles.exists(brew.paths.binary), "Homebrew runtime changed or a competing CLI was created")
    try expect(SetupStatus.inspect(paths: brewPaths).ready && SetupStatus.inspect(paths: brewPaths).spicetifySource == .homebrew, "Installed Homebrew setup wasn't recognized")
    brew.closed = false
    try fails("Manager took over a Homebrew update") { _ = try external.install(architecture: "arm64", intent: .updateSpicetify) }
    try files.removeItem(at: runtime.appendingPathComponent("jsHelper/spicetifyWrapper.js"))
    try expect(!SetupStatus.inspect(paths: brewPaths).ready, "Missing Homebrew helpers were reported healthy")
    try fails("Broken Homebrew wrapper was overwritten") { _ = try external.install(architecture: "arm64", intent: .repair) }
    try expect(!brew.closed, "Homebrew repair guidance arrived after modifying Spotify")

    // Discovering Homebrew after a crash must not hide a saved private CLI.
    let interrupted = try Fixture()
    let saved = interrupted.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
    _ = try InstallSnapshot(directory: saved, paths: interrupted.paths.protectedPaths)
    var record = InstallJournal(spotify: interrupted.paths.spotify, updateState: try SpotifyUpdateState(directory: interrupted.paths.spotifyUpdates))
    record.hasSnapshot = true; try record.save(in: saved)
    try files.removeItem(at: interrupted.paths.binary)
    let rediscovered = InstallerPaths(home: interrupted.paths.home, spotify: interrupted.paths.spotify, environment: ["PATH": link.deletingLastPathComponent().path])
    let recovery = try TagifyInstaller(paths: rediscovered)
    recovery.closeSpotify = { interrupted.closed = true }
    recovery.diskVolume = { _ in InstallerVolume(id: "disk", name: "Test drive", available: 0) }
    try fails("Low-space restore was attempted") { try recovery.recoverInterruptedInstallation() }
    try expect(!interrupted.closed && text(interrupted.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Low-space restore changed current files")
    recovery.diskVolume = InstallerDiskSpace.volume
    try recovery.recoverInterruptedInstallation()
    try expect(text(interrupted.paths.binary) == "Old binary", "Homebrew discovery hid the original managed-runtime recovery target")

    let low = try Fixture()
    low.installer.diskVolume = { _ in InstallerVolume(id: "disk", name: "Test drive", available: 1) }
    low.installer.download = { _, _ in throw InstallerFailure(message: "Downloads must not start with insufficient space") }
    var message = ""
    do { _ = try low.installer.install(architecture: "arm64") } catch { message = error.localizedDescription }
    try expect(message.contains("Not enough free space") && message.contains("Test drive") && message.contains("Free up space"), "Low-space error lacks a useful next action")
    try expect(!low.closed && low.installer.backupURL == nil && text(low.paths.binary) == "Old binary", "Low-space preflight changed the installation")
    let late = try Fixture()
    let download = late.installer.download
    late.installer.download = { url, destination in
        try download(url, destination)
        if url.lastPathComponent.hasSuffix("tar.gz") { late.installer.diskVolume = { _ in InstallerVolume(id: "disk", name: "Test drive", available: 0) } }
    }
    try fails("Space lost during downloads was ignored") { _ = try late.installer.install(architecture: "arm64") }
    try expect(!late.closed && late.installer.backupURL == nil && text(late.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Post-download space check ran after mutation")
    let a = URL(fileURLWithPath: "/drive-a"), b = URL(fileURLWithPath: "/drive-b")
    try fails("Same-volume needs weren't combined") {
        try InstallerDiskSpace.check([.init(path: a, bytes: 60), .init(path: b, bytes: 60)], reserve: 0, volume: { _ in InstallerVolume(id: "same", name: "Shared", available: 100) })
    }
    try InstallerDiskSpace.check([.init(path: a, bytes: 80), .init(path: b, bytes: 80)], reserve: 0, volume: { InstallerVolume(id: $0.path, name: $0.path, available: 100) })
    try fails("A full secondary volume was ignored") {
        try InstallerDiskSpace.check([.init(path: a, bytes: 80), .init(path: b, bytes: 80)], reserve: 0, volume: { InstallerVolume(id: $0.path, name: $0.path, available: $0 == b ? 10 : 1000) })
    }
    try fails("Space arithmetic overflowed") { _ = try InstallerDiskSpace.adding(Int64.max, 1) }
    try expect(try InstallerDiskSpace.expandedArchiveBytes("-rw-r--r-- 1 501 20 900000000 Oct 11 12:00 large file.js\ndrwxr-xr-x 1 501 20 0 Oct 11 12:00 folder") == 900004096, "Expanded archive size ignored large files or names with spaces")
    try fails("Unreadable expanded size accepted") { _ = try InstallerDiskSpace.expandedArchiveBytes("-rw-r--r-- bad listing") }
    try expect(try InstallerDiskSpace.volume(at: low.root.appendingPathComponent("not/yet/created")).available > 0, "Real disk lookup couldn't use the nearest existing parent")

    let unblock = try Fixture()
    try files.createDirectory(at: unblock.paths.spotifyUpdates, withIntermediateDirectories: true)
    try put(unblock.paths.spotifyUpdates.appendingPathComponent("cached"), "keep cached data")
    let originalFlags = UInt32(UF_IMMUTABLE | UF_NODUMP)
    try expect(chflags(unblock.paths.spotifyUpdates.path, originalFlags) == 0, "Couldn't create blocked fixture")
    try files.removeItem(at: unblock.paths.binary)
    try files.removeItem(at: unblock.paths.prefs)
    try files.removeItem(at: unblock.paths.spotify)
    unblock.installer.command = { _, _, _ in throw InstallerFailure(message: "Unblock must not execute Spicetify") }
    unblock.installer.diskVolume = { _ in InstallerVolume(id: "disk", name: "Test drive", available: 1024 * 1024) }
    unblock.installer.changeUpdateFlags = { url, flags in
        chflags(url.path, flags)
        throw InstallerFailure(message: "Simulated failure after clearing flags")
    }
    try fails("Native unblock failure reported success") { try unblock.installer.applySpotifyUpdateSetting(blocked: false) }
    try expect(try SpotifyUpdateState.directoryFlags(unblock.paths.spotifyUpdates) == originalFlags, "Failed native unblock didn't restore exact flags")
    unblock.installer.changeUpdateFlags = { _, _ in }
    try fails("Silent native flag failure accepted") { try unblock.installer.applySpotifyUpdateSetting(blocked: false) }
    unblock.installer.changeUpdateFlags = { url, flags in
        guard chflags(url.path, flags) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }
    try unblock.installer.applySpotifyUpdateSetting(blocked: false)
    try expect(try SpotifyUpdateState.directoryFlags(unblock.paths.spotifyUpdates) == UInt32(UF_NODUMP), "Unblock removed unrelated flags")
    try expect(text(unblock.paths.spotifyUpdates.appendingPathComponent("cached")) == "keep cached data", "Unblock deleted pending update content")
    try put(unblock.paths.spotifyUpdates.appendingPathComponent("write-check"), "works")
    unblock.closed = false
    try unblock.installer.applySpotifyUpdateSetting(blocked: false)
    try expect(!unblock.closed, "Already allowed updates unnecessarily closed Spotify")
    try files.removeItem(at: unblock.paths.spotifyUpdates)
    try unblock.installer.applySpotifyUpdateSetting(blocked: false)
    try expect(!InstallerFiles.exists(unblock.paths.spotifyUpdates), "Unblocking a missing folder created needless files")

    try testBackupRetention()
}

func testBackupRetention() throws {
    let fixture = try Fixture()
    var completed: [URL] = []
    for index in 0..<8 {
        let folder = fixture.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
        _ = try InstallSnapshot(directory: folder, paths: [fixture.paths.key])
        var record = InstallJournal(spotify: fixture.paths.spotify, updateState: try SpotifyUpdateState(directory: fixture.paths.spotifyUpdates))
        record.hasSnapshot = true; record.status = .committed; record.completedAt = Date(timeIntervalSince1970: Double(index))
        try record.save(in: folder)
        completed.append(folder)
    }
    let pendingPayload = completed[0].appendingPathComponent("pending-spotify-update")
    try put(pendingPayload.appendingPathComponent("app"), "old pending update")
    chflags(pendingPayload.path, UInt32(UF_IMMUTABLE))
    let outside = fixture.root.appendingPathComponent("outside-retention")
    try put(outside.appendingPathComponent("keep"), "unrelated")
    chflags(outside.path, UInt32(UF_IMMUTABLE))
    try files.createSymbolicLink(at: completed[1].appendingPathComponent("1"), withDestinationURL: outside)
    let active = fixture.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
    try files.createDirectory(at: active, withIntermediateDirectories: true)
    try InstallJournal(spotify: fixture.paths.spotify, updateState: SpotifyUpdateState(directory: fixture.paths.spotifyUpdates)).save(in: active)
    let old = fixture.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
    try files.createDirectory(at: old, withIntermediateDirectories: true)
    var legacy = InstallJournal(spotify: fixture.paths.spotify, updateState: try SpotifyUpdateState(directory: fixture.paths.spotifyUpdates))
    legacy.status = .committed; legacy.retentionVersion = nil
    try legacy.save(in: old)
    let unknown = fixture.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
    try put(unknown.appendingPathComponent("operation.json"), "damaged record")
    try put(completed[2].appendingPathComponent("user-added-file"), "keep")
    let linked = fixture.paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
    try files.createSymbolicLink(at: linked, withDestinationURL: completed[7])
    var separateGroups: [[URL]] = []
    for (prefix, spotify) in [("update-setting-", fixture.paths.spotify), ("setup-", fixture.root.appendingPathComponent("Other Spotify.app"))] {
        var folders: [URL] = []
        for index in 0..<4 {
            let folder = fixture.paths.backups.appendingPathComponent(prefix + UUID().uuidString)
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            var record = InstallJournal(spotify: spotify, updateState: try SpotifyUpdateState(directory: fixture.paths.spotifyUpdates))
            record.status = .restored; record.completedAt = Date(timeIntervalSince1970: Double(index))
            try record.save(in: folder)
            folders.append(folder)
        }
        separateGroups.append(folders)
    }
    try InstallerBackupRetention.prune(in: fixture.paths.backups, log: { _ in })
    for folders in separateGroups {
        try expect(!InstallerFiles.exists(folders[0]), "Completed setting or second-copy backup wasn't pruned")
        for folder in folders.suffix(3) { try expect(InstallerFiles.exists(folder), "Setting or second-copy backups shared the wrong retention limit") }
    }
    for folder in completed.suffix(3) { try expect(InstallerFiles.exists(folder), "Latest three completed backups weren't retained") }
    for index in [0, 1, 3, 4] { try expect(!InstallerFiles.exists(completed[index]), "Older completed backup wasn't cleaned") }
    for folder in [active, old, unknown, completed[2], linked] { try expect(InstallerFiles.exists(folder), "Retention removed an unfinished, unknown, linked or user-augmented backup") }
    try expect(text(outside.appendingPathComponent("keep")) == "unrelated" && SpotifyUpdateState.directoryFlags(outside) == UInt32(UF_IMMUTABLE), "Retention followed a link or changed its target's flags")
    try InstallerBackupRetention.prune(in: fixture.paths.backups, log: { _ in })
    try expect(InstallerFiles.exists(completed[7]), "Repeat retention removed a kept backup")
}
