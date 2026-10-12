import Foundation
import Darwin

func testHardening() throws {
    for value in ["3.1.1-beta.1", "v3.1.1-rc.2+build.4", "3.1.0+local"] {
        try expect(InstalledVersion(value) != nil, "Installed version not recognized: \(value)")
    }
    for value in ["3.1.1-", "3.1.1-beta..1", "3.1.1-beta.01", "3.1.1+", "3.1.1+bad+meta"] {
        try expect(InstalledVersion(value) == nil, "Malformed installed version accepted: \(value)")
    }
    try expect(InstalledVersion("3.1.0-beta.9")! < InstalledVersion("3.1.0-beta.10")!, "Beta numeric order wrong")
    try expect(InstalledVersion("3.1.0-rc.1")! < InstalledVersion("3.1.0")!, "Stable precedence wrong")

    let beta = try Fixture(fresh: true)
    _ = try beta.installer.install(architecture: "arm64")
    try put(beta.paths.tagify.appendingPathComponent("package.json"), "{\"version\":\"3.1.1-beta.1\"}")
    let before = SetupStatus.inspect(paths: beta.paths)
    try expect(before.ready && before.tagifyVersion == "3.1.1-beta.1" && !before.needsTagifyUpdate(latest: "4.0.0"), "Beta changed channel or was called missing")
    beta.installer.download = { _, _ in throw InstallerFailure(message: "Offline") }
    let repaired = try beta.installer.install(architecture: "arm64", intent: .repair)
    try expect(repaired == "3.1.1-beta.1" && SetupStatus.inspect(paths: beta.paths).ready, "Offline repair changed beta version")
    try expect(text(beta.paths.tagify.appendingPathComponent("extension.js")).components(separatedBy: "globalThis.__tagifyInstallRecoveryKey=").count == 2, "Repair duplicated recovery bootstrap")
    try put(beta.paths.tagify.appendingPathComponent("index.js"), "")
    let key = text(beta.paths.key)
    try fails("Unavailable exact beta repair replaced the installation") { _ = try beta.installer.install(architecture: "arm64", intent: .repair) }
    try expect(TagifyPackage.version(at: beta.paths.tagify) == "3.1.1-beta.1" && text(beta.paths.key) == key, "Failed beta repair changed installed files")

    let future = try Fixture(fresh: true)
    _ = try future.installer.install(architecture: "arm64")
    try put(future.paths.tagify.appendingPathComponent("package.json"), "{\"version\":\"9.0.0\"}")
    try expect(try future.installer.install(architecture: "arm64") == "9.0.0", "Update downgraded a newer installed version")

    let sameVersion = try Fixture(fresh: true)
    _ = try sameVersion.installer.install(architecture: "arm64")
    try files.removeItem(at: sameVersion.paths.tagify.appendingPathComponent("index.js"))
    try files.removeItem(at: sameVersion.paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js"))
    try expect(try sameVersion.installer.install(architecture: "arm64", intent: .repair) == "3.0.0", "Same-version download repair failed")
    try expect(SetupStatus.inspect(paths: sameVersion.paths).ready && TagifyPackage.nonemptyFile(sameVersion.paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js")), "Repair didn't replace missing same-version files")
    sameVersion.reportedVersion = "3.0.0-beta.1"
    try put(sameVersion.paths.binary, "#!/bin/sh\necho 3.0.0-beta.1\n")
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sameVersion.paths.binary.path)
    let betaCLI = text(sameVersion.paths.binary)
    _ = try sameVersion.installer.install(architecture: "arm64")
    try expect(text(sameVersion.paths.binary) == betaCLI && SetupStatus.inspect(paths: sameVersion.paths).spicetifyVersion == "3.0.0-beta.1", "A Tagify update replaced a beta CLI with stable")

    let incomplete = try Fixture()
    let originalCommand = incomplete.installer.command
    incomplete.installer.command = { executable, args, environment in
        let result = try originalCommand(executable, args, environment)
        if executable == incomplete.paths.binary && args.contains("apply") {
            try put(incomplete.paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"), "")
        }
        return result
    }
    try put(incomplete.paths.key, "damaged-key\n")
    try fails("Empty applied file committed an installation") { _ = try incomplete.installer.install(architecture: "arm64") }
    incomplete.installer.command = originalCommand
    try expect(text(incomplete.paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Failed final check didn't restore Tagify")
    try expect(text(incomplete.paths.key) == "damaged-key\n", "Failed final check didn't restore the previous recovery identity")
    try expect(try InstallJournal.pending(in: incomplete.paths.backups).isEmpty, "Successful rollback left pending recovery")

    let custom = try Fixture()
    let source = custom.root.appendingPathComponent("distribution")
    let destination = custom.paths.binary.deletingLastPathComponent()
    for folder in ["Themes", "Extensions", "CustomApps"] {
        try put(source.appendingPathComponent("\(folder)/bundled/file"), "bundled v1")
        try put(destination.appendingPathComponent("\(folder)/mine/file"), "user content")
    }
    try put(source.appendingPathComponent("Themes/edited/file"), "upstream")
    try put(destination.appendingPathComponent("Themes/edited/file"), "custom before manager")
    try SpicetifyDistribution.install(from: source, to: destination, log: { _ in })
    try put(destination.appendingPathComponent("Extensions/bundled/file"), "user edit")
    for folder in ["Themes", "Extensions", "CustomApps"] { try put(source.appendingPathComponent("\(folder)/bundled/file"), "bundled v2") }
    try SpicetifyDistribution.install(from: source, to: destination, log: { _ in })
    for folder in ["Themes", "Extensions", "CustomApps"] {
        try expect(text(destination.appendingPathComponent("\(folder)/mine/file")) == "user content", "Lost extra \(folder)")
    }
    try expect(text(destination.appendingPathComponent("Themes/edited/file")) == "custom before manager", "Overwrote unowned customization")
    try expect(text(destination.appendingPathComponent("Extensions/bundled/file")) == "user edit", "Overwrote edited bundled file")
    try expect(text(destination.appendingPathComponent("Themes/bundled/file")) == "bundled v2", "Unmodified bundled file wasn't updated")
    let outside = custom.root.appendingPathComponent("outside")
    try put(outside.appendingPathComponent("file"), "keep outside")
    try files.createSymbolicLink(at: destination.appendingPathComponent("Themes/linked"), withDestinationURL: outside)
    try put(source.appendingPathComponent("Themes/linked/file"), "overwrite outside")
    try SpicetifyDistribution.install(from: source, to: destination, log: { _ in })
    try expect(text(outside.appendingPathComponent("file")) == "keep outside", "Customization merge followed a symbolic link")

    let original = custom.root.appendingPathComponent("restore-target")
    try put(original, "saved value")
    let snapshot = try InstallSnapshot(directory: custom.root.appendingPathComponent("restore-test"), paths: [original])
    try put(original, "working value")
    try put(snapshot.entries[0].saved, "corrupted copy")
    try fails("Corrupt backup accepted") { try snapshot.restore() }
    try expect(text(original) == "working value", "Corrupt backup destroyed current file")
    try files.removeItem(at: snapshot.entries[0].saved)
    try fails("Missing backup accepted") { try snapshot.restore() }
    try expect(text(original) == "working value", "Missing backup destroyed current file")
    try put(snapshot.entries[0].saved, "saved value")
    try snapshot.restore()
    try expect(text(original) == "saved value", "Atomic restoration failed")
    try snapshot.restore()
    try expect(text(original) == "saved value", "Restoration wasn't repeatable")

    let linked = try Fixture()
    let target = linked.paths.binary.deletingLastPathComponent()
    let actual = linked.root.appendingPathComponent("linked-runtime")
    try files.moveItem(at: target, to: actual)
    try files.createSymbolicLink(at: target, withDestinationURL: actual)
    try fails("Linked runtime was changed without backing up its target") { _ = try linked.installer.install(architecture: "arm64") }
    try expect(text(actual.appendingPathComponent("spicetify")) == "Old binary" && !linked.closed, "Linked runtime preflight changed setup")

    try testInterruptedRecovery()
}

// Separate processes exit without running catch/defer or destructors. The next
// process must recover using disk records alone, including before file snapshots.
func runCrashFixtureIfRequested() throws {
    guard CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--crash-fixture" else { return }
    let fixture = try Fixture()
    try put(URL(fileURLWithPath: CommandLine.arguments[2]), fixture.root.path)
    let point = CommandLine.arguments[3]
    if point == "close" { fixture.installer.closeSpotify = { _exit(86) } }
    fixture.installer.progress = { step, _ in if String(step) == point { _exit(86) } }
    _ = try fixture.installer.install(architecture: "arm64")
    throw InstallerFailure(message: "Crash checkpoint not reached")
}

func testInterruptedRecovery() throws {
    for point in ["close", "3", "4", "5"] {
        let marker = files.temporaryDirectory.appendingPathComponent("tagify-crash-test-\(UUID().uuidString)")
        defer { try? files.removeItem(at: marker) }
        let temporary = files.temporaryDirectory.appendingPathComponent("tagify-crash-work-\(UUID().uuidString)")
        try files.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: temporary) }
        var environment = ProcessInfo.processInfo.environment
        environment["TMPDIR"] = temporary.path + "/"
        let result = try InstallerSystem.run(URL(fileURLWithPath: CommandLine.arguments[0]), ["--crash-fixture", marker.path, point], environment)
        try expect(result.status == 86, "Crash child failed before checkpoint: \(result.output)")
        let root = URL(fileURLWithPath: text(marker))
        let paths = InstallerPaths(home: root.appendingPathComponent("User Home"), spotify: root.appendingPathComponent("Spotify.app"), environment: [:])
        defer {
            if let entries = files.enumerator(at: root, includingPropertiesForKeys: nil) { for case let url as URL in entries { chflags(url.path, 0) } }
            try? files.removeItem(at: root)
        }
        let pending = try InstallJournal.pending(in: paths.backups)
        try expect(pending.count == 1, "Interrupted operation wasn't discoverable at \(point)")
        let recovery = try TagifyInstaller(paths: paths)
        recovery.download = { _, _ in throw InstallerFailure(message: "Recovery must work offline") }
        try fails("New installation bypassed recovery") { _ = try recovery.install(architecture: "arm64") }
        try recovery.recoverInterruptedInstallation()
        try expect(text(paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Restart recovery lost old Tagify at \(point)")
        try expect(text(paths.binary) == "Old binary", "Restart recovery lost old CLI at \(point)")
        try expect(text(paths.resources.appendingPathComponent("Apps/xpui/original.js")) == "Original Spotify", "Restart recovery lost Spotify at \(point)")
        try expect(text(paths.key) == "tgfy_install_" + String(repeating: "x", count: 43) + "\n", "Restart recovery lost recovery key")
        try expect(!InstallerFiles.exists(paths.spotifyUpdates), "Restart recovery left update protection changed")
        try expect(try InstallJournal.pending(in: paths.backups).isEmpty, "Restart recovery wasn't marked complete")
        try recovery.recoverInterruptedInstallation()
        try expect(text(paths.tagify.appendingPathComponent("extension.js")) == "Old extension", "Repeated recovery changed files")
    }
}
