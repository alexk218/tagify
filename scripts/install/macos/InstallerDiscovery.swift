import Foundation

enum SpicetifySource: String { case manager, homebrew, external }

enum InstallerDiscovery {
    static func expandedPath(_ value: String?, home: URL) -> URL? {
        guard var value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        if value == "~" { value = home.path }
        else if value.hasPrefix("~/") { value = home.path + value.dropFirst() }
        value = value.replacingOccurrences(of: "${HOME}", with: home.path).replacingOccurrences(of: "$HOME", with: home.path)
        guard value.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: value).standardizedFileURL
    }

    static func spicetify(home: URL, environment: [String: String]) -> (URL, SpicetifySource) {
        let managed = home.appendingPathComponent(".spicetify/spicetify")
        var candidates = [managed]
        candidates += (environment["PATH"] ?? "").split(separator: ":").filter { $0.hasPrefix("/") }
            .map { URL(fileURLWithPath: String($0)).appendingPathComponent("spicetify") }
        // Finder does not inherit the user's shell PATH. Keep test/other-account homes isolated.
        if home.standardizedFileURL == FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL {
            candidates += ["/opt/homebrew/bin/spicetify", "/usr/local/bin/spicetify"].map { URL(fileURLWithPath: $0) }
        }
        for candidate in candidates where InstallerFiles.exists(candidate) {
            let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
            if candidate == managed, (try? FileManager.default.attributesOfItem(atPath: candidate.path)[.type] as? FileAttributeType) != .typeSymbolicLink { return (managed, .manager) }
            // Detect broken links too: do not quietly install a second CLI over a package-managed setup.
            let source: SpicetifySource = resolved.path.contains("/Cellar/spicetify-cli/") || resolved.path.contains("/opt/spicetify-cli/") ? .homebrew : .external
            return (resolved, source)
        }
        return (managed, .manager)
    }

    static func spotifyApp(_ url: URL) -> Bool {
        guard let plist = NSDictionary(contentsOf: url.appendingPathComponent("Contents/Info.plist")),
              plist["CFBundleIdentifier"] as? String == "com.spotify.client",
              let executable = plist["CFBundleExecutable"] as? String, !executable.isEmpty,
              !executable.contains("/"), executable != ".", executable != "..",
              FileManager.default.isExecutableFile(atPath: url.appendingPathComponent("Contents/MacOS/" + executable).path) else { return false }
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("Contents/Resources/Apps").path, isDirectory: &directory) && directory.boolValue
    }

    static func spotifyPrepared(_ prefs: URL) -> Bool {
        guard TagifyPackage.nonemptyFile(prefs),
              let contents = try? String(contentsOf: prefs, encoding: .utf8),
              let version = TagifyInstaller.iniValue(contents, section: nil, key: "app.last-launched-version")?.trimmingCharacters(in: CharacterSet(charactersIn: "\"")) else { return false }
        return version.range(of: #"^\d+\.\d+\.\d+(?:[.\-][A-Za-z0-9.\-]+)?$"#, options: .regularExpression) != nil
    }

    static func findSpotify(home: URL, config: URL, preferred: String?, running: [URL] = [], registered: URL? = nil) -> URL? {
        let contents = (try? String(contentsOf: config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
        var candidates: [URL] = []
        if let chosen = expandedPath(preferred, home: home) { candidates.append(chosen) }
        if let path = expandedPath(TagifyInstaller.iniValue(contents, section: "Setting", key: "spotify_path"), home: home) {
            candidates.append(path.lastPathComponent == "Resources" ? path.deletingLastPathComponent().deletingLastPathComponent() : path)
        }
        candidates += running
        candidates += [home.appendingPathComponent("Applications/Spotify.app"), URL(fileURLWithPath: "/Applications/Spotify.app")]
        if let registered = registered { candidates.append(registered) }
        return candidates.first(where: spotifyApp)
    }
}
