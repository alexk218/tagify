import Foundation
import Darwin

func runVolumeFixtureIfRequested() throws -> Bool {
    guard CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--volume-fixture" else { return false }
    let mount = URL(fileURLWithPath: CommandLine.arguments[2])
    let readOnly = CommandLine.arguments[3] == "readonly"
    let fixture = try Fixture()
    let spotify = mount.appendingPathComponent("Spotify.app")
    if !readOnly { try files.copyItem(at: fixture.paths.spotify, to: spotify) }
    let paths = InstallerPaths(home: fixture.paths.home, spotify: spotify, environment: [:])
    let engine = try TagifyInstaller(paths: paths)
    var closed = false
    engine.closeSpotify = { closed = true }
    engine.download = { _, _ in throw InstallerFailure(message: "No download should start") }
    var message = ""
    do { _ = try engine.install(architecture: "arm64") } catch { message = error.localizedDescription }
    if readOnly {
        try expect(SetupStatus.inspect(paths: paths).spotifyReadOnly && message.contains("read-only"), "Real read-only Spotify wasn't identified before setup")
    } else {
        try expect(try InstallerDiskSpace.volume(at: mount).id != InstallerDiskSpace.volume(at: fixture.paths.home).id, "Test image did not create a separate filesystem")
        try expect(message.contains("Not enough free space") && message.contains("Tagify Test Volume"), "Real small-volume space exhaustion wasn't identified")
        let smallHome = mount.appendingPathComponent("Small Home")
        let small = InstallerPaths(home: smallHome, spotify: mount.appendingPathComponent("Missing.app"), environment: [:])
        try files.createDirectory(at: small.spotifyUpdates, withIntermediateDirectories: true)
        chflags(small.spotifyUpdates.path, UInt32(UF_IMMUTABLE))
        defer { chflags(small.spotifyUpdates.path, 0) }
        let unblock = try TagifyInstaller(paths: small)
        try unblock.applySpotifyUpdateSetting(blocked: false)
        try put(small.spotifyUpdates.appendingPathComponent("new-download"), "allowed")
        try expect(!SpotifyUpdateState.isBlocked(small.spotifyUpdates), "Small-volume unblock depended on install-sized free space")
    }
    try expect(!closed && engine.backupURL == nil, "Real-volume rejection occurred after Spotify was changed")
    print("PASS: actual \(readOnly ? "read-only" : "low-space") mounted-volume checks (\(assertions) assertions).")
    return true
}
