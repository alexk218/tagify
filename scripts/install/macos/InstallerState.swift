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

struct InstallerPreferences: Codable {
    var tutorialCompleted = false
    var blockSpotifyUpdates: Bool?

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
    var signedIn = false
    var spotifyVersion: String?
    var spicetifyVersion: String?
    var tagifyVersion: String?
    var tagifyApplied = false
    var updatesBlocked: Bool?

    var ready: Bool { spotifyFound && signedIn && spicetifyVersion != nil && tagifyApplied }

    static func inspect(paths: InstallerPaths, command: (URL, [String], [String: String]) throws -> CommandResult = { try InstallerSystem.run($0, $1, $2, timeout: 8) }) -> SetupStatus {
        let files = FileManager.default
        let plist = NSDictionary(contentsOf: paths.spotify.appendingPathComponent("Contents/Info.plist"))
        var result = SetupStatus()
        result.spotifyFound = plist?["CFBundleIdentifier"] as? String == "com.spotify.client" && files.fileExists(atPath: paths.resources.appendingPathComponent("Apps").path)
        result.signedIn = files.fileExists(atPath: paths.prefs.path)
        let prefs = (try? String(contentsOf: paths.prefs, encoding: .utf8)) ?? ""
        let launchedVersion = TagifyInstaller.iniValue(prefs, section: nil, key: "app.last-launched-version")?.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        result.spotifyVersion = plist?["CFBundleShortVersionString"] as? String ?? launchedVersion
        if files.isExecutableFile(atPath: paths.binary.path),
           let reported = try? command(paths.binary, ["-v"], ["HOME": paths.home.path, "SPICETIFY_CONFIG": paths.config.path, "PATH": "/usr/bin:/bin"]),
           reported.status == 0, let version = StableVersion(reported.output.trimmingCharacters(in: .whitespacesAndNewlines)) {
            result.spicetifyVersion = version.string
        }
        if let package = try? Data(contentsOf: paths.tagify.appendingPathComponent("package.json")),
           let json = try? JSONSerialization.jsonObject(with: package) as? [String: Any],
           let version = json["version"] as? String, StableVersion(version) != nil { result.tagifyVersion = version }
        let config = (try? String(contentsOf: paths.config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
        let enabled = TagifyInstaller.iniValue(config, section: "AdditionalOptions", key: "custom_apps")?.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.contains("tagify") == true
        let configuredPath = TagifyInstaller.iniValue(config, section: "Setting", key: "spotify_path")
        let correctCopy = configuredPath.map { URL(fileURLWithPath: $0).standardizedFileURL == paths.resources.standardizedFileURL } ?? true
        let backupVersion = TagifyInstaller.iniValue(config, section: "Backup", key: "version")
        let currentBackup = backupVersion.flatMap { old in launchedVersion.map { old == $0 } } ?? true
        let required = ["index.js", "extension.js", "style.css", "manifest.json", "package.json"].map { paths.tagify.appendingPathComponent($0) } + [
            paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js"),
            paths.resources.appendingPathComponent("Apps/xpui/extensions/tagify/extension.js")
        ]
        result.tagifyApplied = result.tagifyVersion != nil && enabled && correctCopy && currentBackup && required.allSatisfy {
            ((try? files.attributesOfItem(atPath: $0.path)[.size] as? NSNumber)?.intValue ?? 0) > 0
        }
        do { result.updatesBlocked = try SpotifyUpdateState.isBlocked(paths.spotifyUpdates) }
        catch { result.updatesBlocked = nil }
        return result
    }

    func needsSpicetifyUpdate(latest: String?) -> Bool {
        guard let installed = spicetifyVersion.flatMap(StableVersion.init), let available = latest.flatMap(StableVersion.init) else { return false }
        return available > installed
    }

    func needsTagifyUpdate(latest: String?) -> Bool {
        guard let installed = tagifyVersion.flatMap(StableVersion.init), let available = latest.flatMap(StableVersion.init) else { return false }
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
                      asset.browser_download_url.scheme == "https", asset.browser_download_url.host == "github.com",
                      asset.browser_download_url.user == nil, asset.browser_download_url.password == nil,
                      asset.browser_download_url.query == nil, asset.browser_download_url.fragment == nil,
                      asset.browser_download_url.path == "/\(repository)/releases/download/\(release.tag_name)/\(name)",
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
        let data = try json(URL(string: "https://api.github.com/repos/\(repository)/releases?per_page=100")!)
        return select(try JSONDecoder().decode([InstallerRelease].self, from: data), installed: installed)
    }

    static func latestTagify() throws -> String {
        let release = try JSONDecoder().decode(Release.self, from: json(URL(string: "https://api.github.com/repos/alexk218/tagify/releases/latest")!))
        _ = try release.asset(repository: "alexk218/tagify", architecture: "arm64")
        return String(release.tag_name.drop(while: { $0 == "v" }))
    }

    static func latestSpicetify(architecture: String) throws -> String {
        let release = try JSONDecoder().decode(Release.self, from: json(URL(string: "https://api.github.com/repos/spicetify/cli/releases/latest")!))
        _ = try release.asset(repository: "spicetify/cli", architecture: architecture)
        return String(release.tag_name.drop(while: { $0 == "v" }))
    }

    static func download(_ update: InstallerUpdate, downloads: URL, transfer: (URL, URL) throws -> Void = InstallerSystem.download) throws -> URL {
        let files = FileManager.default
        let temporary = files.temporaryDirectory.appendingPathComponent("tagify-installer-update-\(UUID().uuidString)")
        defer { try? files.removeItem(at: temporary) }
        try transfer(update.asset.browser_download_url, temporary)
        try TagifyInstaller.verify(temporary, digest: update.asset.digest ?? "")
        try files.createDirectory(at: downloads, withIntermediateDirectories: true)
        let ext = URL(fileURLWithPath: update.asset.name).pathExtension
        var destination = downloads.appendingPathComponent("TagifyInstaller-mac-\(update.version.string).\(ext)")
        if files.fileExists(atPath: destination.path) {
            if (try? TagifyInstaller.verify(destination, digest: update.asset.digest ?? "")) != nil { return destination }
            destination = downloads.appendingPathComponent("TagifyInstaller-mac-\(update.version.string)-\(UUID().uuidString).\(ext)")
        }
        try files.moveItem(at: temporary, to: destination)
        return destination
    }
}
