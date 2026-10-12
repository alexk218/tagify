import Foundation
import CryptoKit
import Darwin

let files = FileManager.default
var assertions = 0
func expect(_ value: Bool, _ message: String) throws {
    assertions += 1
    if !value { throw NSError(domain: "InstallerTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
func put(_ url: URL, _ text: String) throws {
    try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(text.utf8).write(to: url)
}
func text(_ url: URL) -> String { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }
func digest(_ url: URL) throws -> String {
    "sha256:" + SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
}
func fails(_ message: String, _ body: () throws -> Void) throws {
    do { try body() } catch { assertions += 1; return }
    throw NSError(domain: "InstallerTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

final class Fixture {
    let root: URL
    let paths: InstallerPaths
    let installer: TagifyInstaller
    var spiceCommands: [[String]] = []
    var closed = false
    var failApply = false
    var corrupt = false
    var omitAppliedFiles = false
    var failUpdateSetting = false
    var ignoreUpdateSetting = false
    var reportedVersion = "2.45.3"
    private var assets: [String: URL] = [:]

    init(fresh: Bool = false, backupMatches: Bool = false) throws {
        root = files.temporaryDirectory.appendingPathComponent("tagify test's files \(UUID().uuidString)")
        let home = root.appendingPathComponent("User Home")
        paths = InstallerPaths(home: home, spotify: root.appendingPathComponent("Spotify.app"), environment: [:])
        try put(paths.spotify.appendingPathComponent("Contents/Info.plist"), """
        <?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.spotify.client</string><key>CFBundleExecutable</key><string>Spotify</string><key>CFBundleShortVersionString</key><string>1.2.3</string></dict></plist>
        """)
        try put(paths.spotify.appendingPathComponent("Contents/MacOS/Spotify"), "#!/bin/sh\nexit 0\n")
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: paths.spotify.appendingPathComponent("Contents/MacOS/Spotify").path)
        try put(paths.resources.appendingPathComponent("Apps/xpui/original.js"), "Original Spotify")
        try put(paths.prefs, "app.last-launched-version=\"1.2.3\"\n")
        try put(home.appendingPathComponent("Library/Application Support/Spotify/PersistentCache/library.json"), "{\"dateModified\":12345,\"tags\":[\"Keep me\"]}")
        if !fresh {
            try put(paths.tagify.appendingPathComponent("extension.js"), "Old extension")
            try put(paths.tagify.appendingPathComponent("package.json"), "{\"version\":\"2.6.0\"}")
            try put(paths.config.appendingPathComponent("config-xpui.ini"), "[Setting]\ncurrent_theme=custom\n[AdditionalOptions]\ncustom_apps=marketplace|other\n[Backup]\nversion=\(backupMatches ? "1.2.3" : "1.0.0")\n")
            try put(paths.state.appendingPathComponent("Backup/xpui.spa"), "Previous backup")
            try put(paths.binary, "Old binary")
            try put(paths.key, "tgfy_install_" + String(repeating: "x", count: 43) + "\n")
        }
        try put(paths.config.appendingPathComponent("Themes/custom/user.css"), "My theme")
        try put(paths.config.appendingPathComponent("CustomApps/other/index.js"), "Other app")
        let tagify = root.appendingPathComponent("tagify-source/tagify")
        for name in ["index.js", "extension.js", "style.css", "manifest.json"] { try put(tagify.appendingPathComponent(name), "New \(name)") }
        try put(tagify.appendingPathComponent("manifest.json"), "{\"name\":\"Tagify\",\"icon\":\"tag\"}")
        try put(tagify.appendingPathComponent("package.json"), "{\"version\":\"3.0.0\"}")
        let tagifyZip = root.appendingPathComponent("tagify-v3.0.0.zip")
        _ = try InstallerSystem.run(URL(fileURLWithPath: "/usr/bin/ditto"), ["-c", "-k", "--keepParent", tagify.path, tagifyZip.path], [:])
        let spice = root.appendingPathComponent("spice-source")
        try put(spice.appendingPathComponent("spicetify"), "#!/bin/sh\necho 2.45.3\n")
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: spice.appendingPathComponent("spicetify").path)
        try put(spice.appendingPathComponent("jsHelper/spicetifyWrapper.js"), "Matching wrapper")
        let spiceTar = root.appendingPathComponent("spicetify-2.45.3-darwin-arm64.tar.gz")
        _ = try InstallerSystem.run(URL(fileURLWithPath: "/usr/bin/tar"), ["-czf", spiceTar.path, "-C", spice.path, "spicetify", "jsHelper"], [:])
        assets["tagify-v3.0.0.zip"] = tagifyZip
        assets["spicetify-2.45.3-darwin-arm64.tar.gz"] = spiceTar
        for (repository, tag, archive) in [("alexk218/tagify", "v3.0.0", tagifyZip), ("spicetify/cli", "v2.45.3", spiceTar)] {
            let manifest: [String: Any] = ["tag_name": tag, "draft": false, "prerelease": false, "assets": [["name": archive.lastPathComponent, "browser_download_url": repository == "alexk218/tagify" ? "https://tagify.fm/releases/client/\(tag)/\(archive.lastPathComponent)" : "https://github.com/\(repository)/releases/download/\(tag)/\(archive.lastPathComponent)", "digest": try digest(archive)]]]
            let url = root.appendingPathComponent(repository.replacingOccurrences(of: "/", with: "-") + ".json")
            try JSONSerialization.data(withJSONObject: manifest).write(to: url)
            assets[repository] = url
        }
        installer = try TagifyInstaller(paths: paths)
        installer.closeSpotify = { [unowned self] in self.closed = true }
        installer.download = { [unowned self] url, target in
            let key = url.host == "tagify.fm" && url.path.hasSuffix(".json") ? "alexk218/tagify" : url.host == "api.github.com" ? url.path.replacingOccurrences(of: "/repos/", with: "").replacingOccurrences(of: "/releases/latest", with: "").replacingOccurrences(of: "/releases/tags/v3.0.0", with: "").replacingOccurrences(of: "/releases/tags/v2.45.3", with: "") : url.lastPathComponent
            guard let asset = self.assets[key] else { throw InstallerFailure(message: "Fixture release unavailable") }
            try files.copyItem(at: asset, to: target)
            if self.corrupt && key.hasSuffix(".zip") { try put(target, "Corrupt download") }
        }
        installer.command = { [unowned self] executable, args, env in
            guard executable == self.paths.binary else { return try InstallerSystem.run(executable, args, env) }
            try expect(env["HOME"] == self.paths.home.path && env["SPICETIFY_CONFIG"] == self.paths.config.path && env["SPICETIFY_STATE"] == self.paths.state.path, "Wrong user, config or state directory")
            self.spiceCommands.append(args)
            if args == ["-v"] { return CommandResult(status: 0, output: self.reportedVersion) }
            if args.contains("config") {
                if args.contains("custom_apps") {
                    let config = self.paths.config.appendingPathComponent("config-xpui.ini")
                    let old = text(config)
                    let updated = old.contains("custom_apps=") ? old.replacingOccurrences(of: "custom_apps=marketplace|other", with: "custom_apps=marketplace|other|tagify") : old + "\n[AdditionalOptions]\ncustom_apps=tagify\n"
                    try put(config, updated)
                } else if !files.fileExists(atPath: self.paths.config.appendingPathComponent("config-xpui.ini").path) {
                    try put(self.paths.config.appendingPathComponent("config-xpui.ini"), "[Setting]\n")
                }
            } else if args.contains("spotify-updates") {
                if !self.ignoreUpdateSetting {
                    try files.createDirectory(at: self.paths.spotifyUpdates, withIntermediateDirectories: true)
                    var flags = try SpotifyUpdateState.directoryFlags(self.paths.spotifyUpdates) ?? 0
                    if args.last == "block" { flags |= UInt32(UF_IMMUTABLE) }
                    else { flags &= ~UInt32(UF_IMMUTABLE) }
                    try expect(chflags(self.paths.spotifyUpdates.path, flags) == 0, "Couldn't change fixture update flags")
                }
                return CommandResult(status: self.failUpdateSetting ? 1 : 0, output: "Disabled Spotify updates!")
            } else if args.contains("apply") {
                let config = self.paths.config.appendingPathComponent("config-xpui.ini")
                let current = text(config).replacingOccurrences(of: "version=1.0.0", with: "version=1.2.3")
                try put(config, current)
                try put(self.paths.resources.appendingPathComponent("Apps/xpui/original.js"), "Changed Spotify")
                try put(self.paths.state.appendingPathComponent("Backup/xpui.spa"), "Changed backup")
                if self.failApply { return CommandResult(status: 1, output: "Simulated apply failure") }
                if !self.omitAppliedFiles {
                    try put(self.paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"), "Applied app")
                    try put(self.paths.resources.appendingPathComponent("Apps/xpui/extensions/tagify/extension.js"), "Applied extension")
                }
            }
            return CommandResult(status: 0, output: "OK")
        }
    }
    deinit {
        if ProcessInfo.processInfo.environment["TAGIFY_TEST_DIAGNOSTICS"] == "1" { print(text(installer.logURL)) }
        chflags(paths.spotifyUpdates.path, 0)
        if let entries = files.enumerator(at: root, includingPropertiesForKeys: nil) {
            for case let url as URL in entries {
                // Successful quarantine preserves the original flags on the saved folder.
                chflags(url.path, 0)
            }
        }
        try? files.removeItem(at: root)
    }
}
