import Foundation
import Darwin

func testUpdateProtection() throws {
    let cached = try Fixture()
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cached.paths.binary.path)
    let pending = cached.paths.spotifyUpdates.appendingPathComponent("Spotify.app/Contents/MacOS/updater")
    try put(pending, "#!/bin/sh\nexit 0\n")
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: pending.path)
    try expect(chflags(cached.paths.spotifyUpdates.path, UInt32(UF_IMMUTABLE)) == 0, "Could not reproduce an existing folder lock")
    try expect(!SpotifyUpdateState.isBlocked(cached.paths.spotifyUpdates), "Folder-only lock accepted an already cached update")
    cached.installer.closeSpotify = {
        try expect(SpotifyUpdateState.isBlocked(cached.paths.spotifyUpdates), "Protection was not applied before Spotify's quit handoff")
        try expect(!files.fileExists(atPath: pending.path), "Quit handoff could still find a pending update")
    }
    try cached.installer.applySpotifyUpdateSetting(blocked: true)
    try expect(SpotifyUpdateState.isBlocked(cached.paths.spotifyUpdates), "Cached update was not removed from the staging location")
    try SpotifyUpdateState.verifyBlocked(cached.paths.spotifyUpdates)
    try expect(!files.fileExists(atPath: pending.path), "Cached executable is still reachable at its update path")
    let saved = cached.installer.backupURL!.appendingPathComponent("pending-spotify-update/Spotify.app/Contents/MacOS/updater")
    try expect(text(saved) == "#!/bin/sh\nexit 0\n", "Cached update was deleted instead of preserved")
    try expect(files.attributesOfItem(atPath: saved.path)[.posixPermissions] as? NSNumber == 0o755, "Cached executable permissions changed")
    let journal = cached.installer.backupURL!.appendingPathComponent("spotify-updates.json")
    let snapshot = try JSONDecoder().decode(SpotifyUpdateState.self, from: Data(contentsOf: journal))
    try snapshot.restore()
    try expect(text(pending) == "#!/bin/sh\nexit 0\n", "Recovery journal did not restore cached update bytes")
    try expect(SpotifyUpdateState.directoryFlags(cached.paths.spotifyUpdates) == UInt32(UF_IMMUTABLE), "Recovery did not restore exact original flags")

    let rollback = try Fixture()
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: rollback.paths.binary.path)
    try put(rollback.paths.spotifyUpdates.appendingPathComponent("nested/payload"), "pending update")
    rollback.failUpdateSetting = true
    try fails("Cached-update failure was accepted") { try rollback.installer.applySpotifyUpdateSetting(blocked: true) }
    try expect(text(rollback.paths.spotifyUpdates.appendingPathComponent("nested/payload")) == "pending update", "Failure lost pending update content")
    try expect(SpotifyUpdateState.directoryFlags(rollback.paths.spotifyUpdates) == 0, "Failure did not restore unlocked state")
    rollback.failUpdateSetting = false
    try rollback.installer.applySpotifyUpdateSetting(blocked: true)
    try SpotifyUpdateState.verifyBlocked(rollback.paths.spotifyUpdates)
    try rollback.installer.applySpotifyUpdateSetting(blocked: false)
    try put(rollback.paths.spotifyUpdates.appendingPathComponent("new-download"), "allowed")
    let moved = rollback.paths.spotifyUpdates.appendingPathExtension("unblocked")
    try files.moveItem(at: rollback.paths.spotifyUpdates, to: moved)
    try files.moveItem(at: moved, to: rollback.paths.spotifyUpdates)
    try expect(!SpotifyUpdateState.isBlocked(rollback.paths.spotifyUpdates), "Unblock did not allow downloads and replacement")

    let quitFailure = try Fixture()
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: quitFailure.paths.binary.path)
    try put(quitFailure.paths.spotifyUpdates.appendingPathComponent("pending"), "restore on canceled quit")
    quitFailure.installer.closeSpotify = { throw InstallerFailure(message: "Spotify could not close") }
    try fails("Failed quit accepted") { try quitFailure.installer.applySpotifyUpdateSetting(blocked: true) }
    try expect(text(quitFailure.paths.spotifyUpdates.appendingPathComponent("pending")) == "restore on canceled quit", "Failed quit lost pending update")
    try expect(SpotifyUpdateState.directoryFlags(quitFailure.paths.spotifyUpdates) == 0, "Failed quit left staging locked")

    let full = try Fixture()
    try put(full.paths.spotifyUpdates.appendingPathComponent("pending"), "full install handoff")
    full.installer.closeSpotify = {
        try expect(SpotifyUpdateState.isBlocked(full.paths.spotifyUpdates), "Full install quit before blocking updates")
        try expect(!files.fileExists(atPath: full.paths.spotifyUpdates.appendingPathComponent("pending").path), "Full install left cached update available on quit")
    }
    _ = try full.installer.install(architecture: "arm64")

    let canceledFull = try Fixture()
    try put(canceledFull.paths.spotifyUpdates.appendingPathComponent("pending"), "full install canceled")
    canceledFull.installer.closeSpotify = { throw InstallerFailure(message: "Spotify could not close") }
    try fails("Full install accepted failed quit") { _ = try canceledFull.installer.install(architecture: "arm64") }
    try expect(text(canceledFull.paths.spotifyUpdates.appendingPathComponent("pending")) == "full install canceled", "Early install failure lost pending update")
    try expect(SpotifyUpdateState.directoryFlags(canceledFull.paths.spotifyUpdates) == 0, "Early install failure left staging locked")

    // Exercise the installed upstream CLI, not the command stub, in a disposable HOME.
    // The harmless pkill shim prevents upstream from closing the user's real Spotify.
    if let binary = ProcessInfo.processInfo.environment["TAGIFY_TEST_REAL_SPICETIFY"] {
        let real = try Fixture()
        try files.removeItem(at: real.paths.binary)
        try files.copyItem(at: URL(fileURLWithPath: binary), to: real.paths.binary)
        let pkill = real.paths.binary.deletingLastPathComponent().appendingPathComponent("pkill")
        try put(pkill, "#!/bin/sh\nexit 0\n")
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: pkill.path)
        try put(real.paths.spotifyUpdates.appendingPathComponent("nested/pending"), "upstream test")
        let installer = try TagifyInstaller(paths: real.paths)
        try installer.applySpotifyUpdateSetting(blocked: true)
        try SpotifyUpdateState.verifyBlocked(real.paths.spotifyUpdates)
        try expect(files.contentsOfDirectory(atPath: real.paths.spotifyUpdates.path).isEmpty, "Real CLI left pending update in staging")
        try installer.applySpotifyUpdateSetting(blocked: false)
        try put(real.paths.spotifyUpdates.appendingPathComponent("download"), "unblocked")
        let renamed = real.paths.spotifyUpdates.appendingPathExtension("renamed")
        try files.moveItem(at: real.paths.spotifyUpdates, to: renamed)
        try files.moveItem(at: renamed, to: real.paths.spotifyUpdates)
        try expect(text(real.paths.spotifyUpdates.appendingPathComponent("download")) == "unblocked", "Real CLI did not restore downloads")
        print("PASS: real Spicetify block/unblock and actual macOS write/rename denial, including pending update quarantine.")
    }
}
