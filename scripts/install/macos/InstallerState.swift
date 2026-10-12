import Foundation
import Darwin

struct StableVersion: Comparable {
    let components: [Int]
    let string: String

    init?(_ value: String) {
        let normalized = value.hasPrefix("v") ? String(value.dropFirst()) : value
        guard normalized.range(of: #"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"#, options: .regularExpression) != nil else { return nil }
        let numbers = normalized.split(separator: ".").compactMap { Int($0) }
        guard numbers.count == 3 else { return nil }
        components = numbers
        string = normalized
    }
    static func < (left: StableVersion, right: StableVersion) -> Bool {
        left.components.lexicographicallyPrecedes(right.components)
    }
    static func == (left: StableVersion, right: StableVersion) -> Bool { left.components == right.components }
}

// Installed versions may be betas; public update discovery remains stable-only.
struct InstalledVersion: Comparable {
    let stable: StableVersion
    let prerelease: String?
    let string: String

    init?(_ raw: String) {
        let value = raw.hasPrefix("v") ? String(raw.dropFirst()) : raw
        let pieces = value.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)
        let release = pieces[0].split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard let stable = StableVersion(String(release[0])) else { return nil }
        func validIdentifiers(_ text: Substring, numericRules: Bool) -> Bool {
            text.split(separator: ".", omittingEmptySubsequences: false).allSatisfy {
                !$0.isEmpty && $0.range(of: #"^[A-Za-z0-9-]+$"#, options: .regularExpression) != nil &&
                (!numericRules || !$0.allSatisfy(\.isNumber) || $0.count == 1 || !$0.hasPrefix("0"))
            }
        }
        guard release.count == 1 || validIdentifiers(release[1], numericRules: true),
              pieces.count == 1 || validIdentifiers(pieces[1], numericRules: false) else { return nil }
        self.stable = stable
        prerelease = release.count == 2 ? String(release[1]) : nil
        string = value
    }
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.stable == rhs.stable && lhs.prerelease == rhs.prerelease }
    static func < (lhs: Self, rhs: Self) -> Bool {
        if lhs.stable != rhs.stable { return lhs.stable < rhs.stable }
        guard let left = lhs.prerelease else { return false }
        guard let right = rhs.prerelease else { return true }
        let a = left.split(separator: "."), b = right.split(separator: ".")
        for (x, y) in zip(a, b) where x != y {
            let xn = x.allSatisfy(\.isNumber), yn = y.allSatisfy(\.isNumber)
            if xn && yn { return x.count == y.count ? x < y : x.count < y.count }
            if xn != yn { return xn }
            return x < y
        }
        return a.count < b.count
    }
}

enum TagifyPackage {
    static let required = ["index.js", "extension.js", "style.css", "manifest.json", "package.json"]
    static func version(at folder: URL) -> String? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("package.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = json["version"] as? String, InstalledVersion(version) != nil else { return nil }
        return version
    }
    static func nonemptyFile(_ url: URL) -> Bool {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber else { return false }
        return size.intValue > 0
    }
    static func valid(at folder: URL) -> Bool {
        guard version(at: folder) != nil, required.allSatisfy({ nonemptyFile(folder.appendingPathComponent($0)) }),
              let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return false }
        return true
    }
}

struct InstallerPreferences: Codable {
    var tutorialCompleted = false
    var blockSpotifyUpdates: Bool?
    var spotifyPath: String?
    var skippedManagerVersion: String?

    static func location(home: URL) -> URL {
        home.appendingPathComponent("Library/Application Support/Tagify/Installer/preferences.json")
    }
    static func load(home: URL) throws -> InstallerPreferences {
        let url = location(home: home)
        guard FileManager.default.fileExists(atPath: url.path) else { return InstallerPreferences() }
        return try JSONDecoder().decode(InstallerPreferences.self, from: Data(contentsOf: url))
    }
    func save(home: URL) throws {
        let url = Self.location(home: home)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

struct SetupStatus {
    var spotifyFound = false
    var spotifyPrepared = false
    var spotifyVersion: String?
    var spicetifyVersion: String?
    var tagifyVersion: String?
    var tagifyApplied = false
    var updatesBlocked: Bool?
    var spicetifySource: SpicetifySource = .manager
    var spotifyReadOnly = false
    var updateFolderLocked: Bool?
    var spicetifyComplete = true

    var ready: Bool { spotifyFound && spotifyPrepared && !spotifyReadOnly && spicetifyVersion != nil && spicetifyComplete && tagifyApplied }

    static func inspect(paths: InstallerPaths, command: (URL, [String], [String: String]) throws -> CommandResult = { try InstallerSystem.run($0, $1, $2, timeout: 8) }) -> SetupStatus {
        let files = FileManager.default
        let plist = NSDictionary(contentsOf: paths.spotify.appendingPathComponent("Contents/Info.plist"))
        var result = SetupStatus()
        result.spotifyFound = InstallerDiscovery.spotifyApp(paths.spotify)
        result.spotifyPrepared = InstallerDiscovery.spotifyPrepared(paths.prefs)
        result.spotifyReadOnly = (try? paths.spotify.resourceValues(forKeys: [.volumeIsReadOnlyKey]).volumeIsReadOnly) == true
        result.spicetifySource = paths.spicetifySource
        result.spicetifyComplete = files.isExecutableFile(atPath: paths.binary.path) && TagifyPackage.nonemptyFile(paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js"))
        let prefs = (try? String(contentsOf: paths.prefs, encoding: .utf8)) ?? ""
        let launchedVersion = TagifyInstaller.iniValue(prefs, section: nil, key: "app.last-launched-version")?.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        result.spotifyVersion = plist?["CFBundleShortVersionString"] as? String ?? launchedVersion
        if files.isExecutableFile(atPath: paths.binary.path),
           let reported = try? command(paths.binary, ["-v"], ["HOME": paths.home.path, "SPICETIFY_CONFIG": paths.config.path, "PATH": "/usr/bin:/bin"]),
           reported.status == 0, let version = InstalledVersion(reported.output.trimmingCharacters(in: .whitespacesAndNewlines)) {
            result.spicetifyVersion = version.string
        }
        result.tagifyVersion = TagifyPackage.version(at: paths.tagify)
        let config = (try? String(contentsOf: paths.config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
        let enabled = TagifyInstaller.iniValue(config, section: "AdditionalOptions", key: "custom_apps")?.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.contains("tagify") == true
        let configuredPath = TagifyInstaller.iniValue(config, section: "Setting", key: "spotify_path")
        let correctCopy = configuredPath.map { URL(fileURLWithPath: $0).standardizedFileURL == paths.resources.standardizedFileURL } ?? true
        let backupVersion = TagifyInstaller.iniValue(config, section: "Backup", key: "version")
        let currentBackup = backupVersion.flatMap { old in launchedVersion.map { old == $0 } } ?? true
        let applied = [
            paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"),
            paths.resources.appendingPathComponent("Apps/xpui/extensions/tagify/extension.js")
        ]
        result.tagifyApplied = TagifyPackage.valid(at: paths.tagify) && enabled && correctCopy && currentBackup && applied.allSatisfy(TagifyPackage.nonemptyFile)
        do {
            result.updatesBlocked = try SpotifyUpdateState.isBlocked(paths.spotifyUpdates)
            result.updateFolderLocked = ((try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates)) ?? 0) & UInt32(UF_IMMUTABLE) != 0
        }
        catch { result.updatesBlocked = nil }
        return result
    }

    func needsSpicetifyUpdate(latest: String?) -> Bool {
        guard let installed = spicetifyVersion.flatMap(InstalledVersion.init), installed.prerelease == nil, let available = latest.flatMap(InstalledVersion.init) else { return false }
        return available > installed
    }

    func needsTagifyUpdate(latest: String?) -> Bool {
        guard let installed = tagifyVersion.flatMap(InstalledVersion.init), installed.prerelease == nil, let available = latest.flatMap(InstalledVersion.init) else { return false }
        return available > installed
    }
}

struct InstallerRelease: Decodable {
    struct Asset: Decodable {
        let name: String
        let browser_download_url: URL
        let digest: String?
    }
    let tag_name: String
    let draft: Bool
    let prerelease: Bool
    let body: String?
    let assets: [Asset]
}

struct InstallerUpdate {
    let version: StableVersion
    let notes: String
    let asset: InstallerRelease.Asset
}

enum InstallerUpdates {
    static let repository = "alexk218/tagify-installer"
    // List releases so a newer Windows-only release cannot hide the most recent Mac build.
    static func select(_ releases: [InstallerRelease], installed: String) -> InstallerUpdate? {
        guard let current = StableVersion(installed) else { return nil }
        return releases.compactMap { release -> InstallerUpdate? in
            guard !release.draft, !release.prerelease, let version = StableVersion(release.tag_name), version > current else { return nil }
            let names = ["TagifyInstaller-mac.dmg", "TagifyInstaller-mac.zip", "Tagify.pkg"]
            for name in names {
                guard let asset = release.assets.first(where: { $0.name == name }),
                      asset.browser_download_url.scheme == "https", asset.browser_download_url.host == "tagify.fm",
                      asset.browser_download_url.user == nil, asset.browser_download_url.password == nil,
                      asset.browser_download_url.query == nil, asset.browser_download_url.fragment == nil,
                      asset.browser_download_url.path == "/releases/manager/\(release.tag_name)/\(name)",
                      asset.digest?.range(of: #"^sha256:[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil else { continue }
                return InstallerUpdate(version: version, notes: release.body ?? "A newer Tagify installer is available for your Mac.", asset: asset)
            }
            return nil
        }.max { $0.version < $1.version }
    }

    static func json(_ url: URL) throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("Tagify-Mac-Installer", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error> = .failure(InstallerFailure(message: "We couldn't check for updates. Check your connection and try again."))
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error = error { result = .failure(error); return }
            guard let response = response as? HTTPURLResponse, response.statusCode == 200, let data = data else { return }
            result = .success(data)
        }
        task.resume()
        guard semaphore.wait(timeout: .now() + 25) == .success else { task.cancel(); throw InstallerFailure(message: "We couldn't check for updates. Check your connection and try again.") }
        return try result.get()
    }

    static func check(installed: String) throws -> InstallerUpdate? {
        let data = try json(URL(string: "https://tagify.fm/releases/manager/releases.json")!)
        return select(try JSONDecoder().decode([InstallerRelease].self, from: data), installed: installed)
    }

    static func latestTagify() throws -> String {
        let release = try JSONDecoder().decode(Release.self, from: json(URL(string: "https://tagify.fm/releases/client/latest.json")!))
        _ = try release.asset(repository: "alexk218/tagify", architecture: "arm64")
        return String(release.tag_name.drop(while: { $0 == "v" }))
    }

    static func latestSpicetify(architecture: String) throws -> String {
        let release = try JSONDecoder().decode(Release.self, from: json(URL(string: "https://api.github.com/repos/spicetify/cli/releases/latest")!))
        _ = try release.asset(repository: "spicetify/cli", architecture: architecture)
        return String(release.tag_name.drop(while: { $0 == "v" }))
    }

}
