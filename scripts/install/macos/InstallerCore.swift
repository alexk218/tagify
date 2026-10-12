import Foundation
import CryptoKit
import Security
import Darwin

struct InstallerFailure: LocalizedError {
    let message: String
    var reason = "setup"
    var errorDescription: String? { message }
}

struct Release: Decodable {
    struct Asset: Decodable {
        let name: String
        let browser_download_url: URL
        let digest: String?
        var size: Int64?
    }
    let tag_name: String
    let draft: Bool
    let prerelease: Bool
    let assets: [Asset]

    func asset(repository: String, architecture: String, allowPrerelease: Bool = false) throws -> Asset {
        guard !draft, (!prerelease || allowPrerelease) else {
            throw InstallerFailure(message: "A stable update couldn't be found. Try again later.")
        }
        let version = tag_name.hasPrefix("v") ? String(tag_name.dropFirst()) : tag_name
        guard InstalledVersion(version) != nil, allowPrerelease || StableVersion(version) != nil else {
            throw InstallerFailure(message: "The update information couldn't be read. Try again later.")
        }
        let names = repository == "alexk218/tagify"
            ? ["tagify-\(tag_name).zip", "tagify-\(version).zip", "tagify-\(tag_name)-metadata-corrected.zip"]
            : ["spicetify-\(version)-darwin-\(architecture).tar.gz"]
        guard let asset = assets.first(where: { names.contains($0.name) }),
              asset.browser_download_url.scheme == "https",
              asset.browser_download_url.host == (repository == "alexk218/tagify" ? "tagify.fm" : "github.com"),
              asset.browser_download_url.user == nil, asset.browser_download_url.password == nil,
              asset.browser_download_url.query == nil, asset.browser_download_url.fragment == nil,
              asset.browser_download_url.path == (repository == "alexk218/tagify" ? "/releases/client/\(tag_name)/\(asset.name)" : "/\(repository)/releases/download/\(tag_name)/\(asset.name)"),
              let digest = asset.digest,
              digest.range(of: #"^sha256:[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil else {
            throw InstallerFailure(message: "A verified download couldn't be found. Try again later.")
        }
        return asset
    }
}

struct CommandResult {
    let status: Int32
    let output: String
}

enum InstallerSystem {
    static func run(_ executable: URL, _ arguments: [String], _ environment: [String: String]) throws -> CommandResult {
        try run(executable, arguments, environment, timeout: 180)
    }

    static func run(_ executable: URL, _ arguments: [String], _ environment: [String: String], timeout: TimeInterval) throws -> CommandResult {
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("tagify-command-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: output.path, contents: nil)
        let handle = try FileHandle(forWritingTo: output)
        defer { try? handle.close(); try? FileManager.default.removeItem(at: output) }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = handle
        process.standardError = handle
        try process.run()
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.5)
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            process.waitUntilExit()
            throw InstallerFailure(message: "Setup took too long. Close Spotify and try again.", reason: "timeout")
        }
        process.waitUntilExit()
        return CommandResult(status: process.terminationStatus, output: (try? String(contentsOf: output, encoding: .utf8)) ?? "")
    }

    static func download(_ url: URL, to destination: URL) throws {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        request.setValue("Tagify-Mac-Installer", forHTTPHeaderField: "User-Agent")
        let complete = DispatchSemaphore(value: 0)
        var outcome: Result<Void, Error> = .failure(InstallerFailure(message: "The download took too long. Check your connection and try again.", reason: "network_timeout"))
        let task = session.downloadTask(with: request) { temporary, response, error in
            defer { complete.signal() }
            do {
                if let error = error { throw error }
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let temporary = temporary else {
                    throw InstallerFailure(message: "The download is unavailable. Check your connection and try again later.", reason: "download_unavailable")
                }
                try FileManager.default.moveItem(at: temporary, to: destination)
                outcome = .success(())
            } catch { outcome = .failure(error) }
        }
        task.resume()
        guard complete.wait(timeout: .now() + 130) == .success else {
            task.cancel()
            throw InstallerFailure(message: "The download took too long. Check your connection and try again.", reason: "network_timeout")
        }
        try outcome.get()
    }
}

struct InstallerPaths {
    let home: URL
    let config: URL
    let state: URL
    let stateOverride: String?
    let binary: URL
    let spicetifySource: SpicetifySource
    let spotify: URL
    var resources: URL { spotify.appendingPathComponent("Contents/Resources") }
    let prefs: URL
    var spotifyUpdates: URL { home.appendingPathComponent("Library/Application Support/Spotify/PersistentCache/Update") }
    var tagify: URL { config.appendingPathComponent("CustomApps/tagify") }
    var key: URL { home.appendingPathComponent(".config/tagify/install-recovery-key") }
    var backups: URL { home.appendingPathComponent("Library/Application Support/Tagify/Installer Backups") }
    var logs: URL { home.appendingPathComponent("Library/Logs/Tagify") }

    var protectedPaths: [URL] {
        let paths = [tagify, config.appendingPathComponent("config-xpui.ini"), state,
                     config.appendingPathComponent("Backup"), config.appendingPathComponent("Extracted"),
                     resources.appendingPathComponent("Apps"), resources.appendingPathComponent("xpui.spa"), key]
            + (spicetifySource == .manager ? [binary.deletingLastPathComponent()] : [])
        return Array(Set(paths.filter { candidate in
            !paths.contains { $0 != candidate && candidate.path.hasPrefix($0.path + "/") }
        })).sorted { $0.path < $1.path }
    }

    init(home: URL = FileManager.default.homeDirectoryForCurrentUser, spotify: URL, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.home = home
        self.spotify = spotify
        config = InstallerDiscovery.expandedPath(environment["SPICETIFY_CONFIG"], home: home) ?? home.appendingPathComponent(".config/spicetify")
        state = InstallerDiscovery.expandedPath(environment["SPICETIFY_STATE"], home: home) ?? home.appendingPathComponent(".local/state/spicetify")
        // The CLI treats an explicit override as the exact state folder, while its default adds
        // Backup/Extracted subdirectories. Keep that distinction for existing installations.
        stateOverride = InstallerDiscovery.expandedPath(environment["SPICETIFY_STATE"], home: home)?.path
            ?? (home.standardizedFileURL == FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL ? nil : state.path)
        (binary, spicetifySource) = InstallerDiscovery.spicetify(home: home, environment: environment)
        let contents = (try? String(contentsOf: config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
        let configuredPrefs = InstallerDiscovery.expandedPath(TagifyInstaller.iniValue(contents, section: "Setting", key: "prefs_path"), home: home)
        prefs = configuredPrefs.flatMap { InstallerFiles.exists($0) ? $0 : nil } ?? home.appendingPathComponent("Library/Application Support/Spotify/prefs")
    }
}

struct SpotifyUpdateState: Codable {
    let directory: URL
    let existed: Bool
    let flags: UInt32
    let pendingDirectory: URL?

    init(directory: URL, backup: URL? = nil) throws {
        self.directory = directory
        let current = try Self.directoryFlags(directory)
        existed = current != nil
        flags = current ?? 0
        let containsPendingUpdate = try current != nil && !FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty
        pendingDirectory = containsPendingUpdate ? backup?.appendingPathComponent("pending-spotify-update") : nil
    }

    static func directoryFlags(_ directory: URL) throws -> UInt32? {
        var info = stat()
        guard lstat(directory.path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        guard info.st_mode & S_IFMT == S_IFDIR else {
            throw InstallerFailure(message: "Spotify's update folder couldn't be used. Reinstall Spotify, then try again.")
        }
        return info.st_flags
    }

    static func isBlocked(_ directory: URL) throws -> Bool {
        guard let flags = try directoryFlags(directory), flags & UInt32(UF_IMMUTABLE) != 0 else { return false }
        // Immutable directories do not protect existing children or prevent cached apps being copied.
        return try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty
    }

    func quarantinePendingUpdate() throws {
        guard let pending = pendingDirectory else { return }
        guard chflags(directory.path, flags & ~UInt32(UF_IMMUTABLE)) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        // Move, rather than delete or copy, a cached update out of the updater's known location.
        try FileManager.default.moveItem(at: directory, to: pending)
        guard chflags(pending.path, flags) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }

    func prepareForBlock() throws {
        try quarantinePendingUpdate()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let current = try Self.directoryFlags(directory) ?? 0
        guard chflags(directory.path, current | UInt32(UF_IMMUTABLE)) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        try Self.verifyBlocked(directory)
    }

    static func verifyBlocked(_ directory: URL) throws {
        guard try isBlocked(directory) else { throw InstallerFailure(message: "Spotify updates couldn't be blocked. Try again.") }
        let probe = directory.appendingPathComponent("tagify-check-\(UUID().uuidString)")
        let fd = Darwin.open(probe.path, O_CREAT | O_EXCL | O_WRONLY, 0o600)
        if fd >= 0 {
            Darwin.close(fd)
            try? FileManager.default.removeItem(at: probe)
            throw InstallerFailure(message: "Spotify's update folder is still writable. Try again.")
        }
        guard errno == EPERM || errno == EACCES else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let moved = directory.deletingLastPathComponent().appendingPathComponent("tagify-check-\(UUID().uuidString)")
        if Darwin.rename(directory.path, moved.path) == 0 {
            guard Darwin.rename(moved.path, directory.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            throw InstallerFailure(message: "Spotify's update folder can still be replaced. Try again.")
        }
        guard errno == EPERM || errno == EACCES else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }

    func restore() throws {
        if let pending = pendingDirectory, try Self.directoryFlags(pending) != nil {
            if let current = try Self.directoryFlags(directory) {
                guard chflags(directory.path, current & ~UInt32(UF_IMMUTABLE)) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                // Do not remove an unexpected file added after the failed operation.
                guard rmdir(directory.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            }
            guard chflags(pending.path, flags & ~UInt32(UF_IMMUTABLE)) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            try FileManager.default.moveItem(at: pending, to: directory)
        }
        guard try Self.directoryFlags(directory) != nil else {
            if existed { throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOENT)) }
            return
        }
        // Restore the exact original folder and flags, including a quarantined pending update.
        guard chflags(directory.path, flags) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        if !existed {
            // Only remove the empty folder created by the command; never delete cached user files.
            guard rmdir(directory.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        }
    }
}

final class InstallSnapshot {
    struct Entry: Codable {
        let original: URL
        let saved: URL
        let existed: Bool
        let fingerprint: String?
    }
    let directory: URL
    private(set) var entries: [Entry] = []
    private let files = FileManager.default

    init(directory: URL, paths: [URL]) throws {
        self.directory = directory
        try files.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for (index, path) in paths.enumerated() {
            let saved = directory.appendingPathComponent(String(index))
            let existed = InstallerFiles.exists(path)
            if existed { try files.copyItem(at: path, to: saved) }
            entries.append(Entry(original: path, saved: saved, existed: existed, fingerprint: existed ? try InstallerFiles.hash(saved) : nil))
        }
        try InstallerFiles.save(entries, to: directory.appendingPathComponent("restore.json"))
    }

    init(directory: URL, allowedPaths: [URL]) throws {
        self.directory = directory
        entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: directory.appendingPathComponent("restore.json")))
        guard !entries.isEmpty, entries.allSatisfy({ entry in
            allowedPaths.contains(where: { $0.standardizedFileURL.path == entry.original.standardizedFileURL.path }) && entry.saved.deletingLastPathComponent().standardizedFileURL.path == directory.standardizedFileURL.path &&
            Int(entry.saved.lastPathComponent) != nil
        }) else { throw InstallerFailure(message: "Your saved setup couldn't be restored automatically. View details for help.") }
    }

    func validate() throws {
        for entry in entries where entry.existed {
            guard let fingerprint = entry.fingerprint, try InstallerFiles.hash(entry.saved) == fingerprint else {
                throw InstallerFailure(message: "Your saved setup couldn't be verified. Your current files have been left in place. View details for help.")
            }
        }
    }

    func restore() throws {
        try validate()
        var failures: [String] = []
        for entry in entries.reversed() {
            do {
                if entry.existed { try InstallerFiles.restore(entry.saved, to: entry.original) }
                else if InstallerFiles.exists(entry.original) { try files.removeItem(at: entry.original) }
            } catch { failures.append("\(entry.original.path): \(error)") }
        }
        if !failures.isEmpty { throw NSError(domain: "TagifyRestore", code: 1, userInfo: [NSLocalizedDescriptionKey: failures.joined(separator: "\n")]) }
    }

}

final class TagifyInstaller {
    let paths: InstallerPaths
    let logURL: URL
    private(set) var backupURL: URL?
    var progress: (Int, String) -> Void = { _, _ in }
    var diagnostic: (String) -> Void = { _ in }
    var closeSpotify: () throws -> Void = {}
    var prepareAnalyticsHandoff: (URL) -> Void = { _ in }
    var authorizeSpotify: (URL) throws -> Void = { _ in
        throw InstallerFailure(message: "Spotify can't be updated here. Choose a writable copy of Spotify and try again.")
    }
    var command: (URL, [String], [String: String]) throws -> CommandResult = InstallerSystem.run
    var download: (URL, URL) throws -> Void = InstallerSystem.download
    var diskVolume: (URL) throws -> InstallerVolume = InstallerDiskSpace.volume
    var changeUpdateFlags: (URL, UInt32) throws -> Void = { url, flags in
        guard chflags(url.path, flags) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }
    private let files = FileManager.default
    private let work: URL
    private let log: FileHandle
    private var environment: [String: String]

    init(paths: InstallerPaths) throws {
        self.paths = paths
        work = files.temporaryDirectory.appendingPathComponent("tagify-install-\(UUID().uuidString)")
        try files.createDirectory(at: work, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try files.createDirectory(at: paths.logs, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        logURL = paths.logs.appendingPathComponent("install-\(UUID().uuidString).log")
        files.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        log = try FileHandle(forWritingTo: logURL)
        environment = ProcessInfo.processInfo.environment
        environment["HOME"] = paths.home.path
        environment["SPICETIFY_CONFIG"] = paths.config.path
        environment["SPICETIFY_STATE"] = paths.stateOverride
        environment["PATH"] = "\(paths.binary.deletingLastPathComponent().path):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    }

    deinit { try? log.close(); try? files.removeItem(at: work) }

    func writeLog(_ text: String) {
        let clean = text.replacingOccurrences(of: #"\x1B\[[0-9;]*[A-Za-z]"#, with: "", options: .regularExpression)
        try? log.write(contentsOf: Data("[\(ISO8601DateFormatter().string(from: Date()))] \(clean)\n".utf8))
        diagnostic(clean)
    }

    func preflight() throws {
        guard getuid() != 0 else {
            throw InstallerFailure(message: "Open Tagify Manager normally from Finder, using your own Mac account.")
        }
        guard InstallerDiscovery.spotifyApp(paths.spotify) else {
            throw InstallerFailure(message: "Choose the Spotify desktop app. If it isn't installed, download it from spotify.com/download first.", reason: "spotify_missing")
        }
        guard (try paths.spotify.resourceValues(forKeys: [.volumeIsReadOnlyKey])).volumeIsReadOnly != true else {
            throw InstallerFailure(message: "Move Spotify to Applications, open that copy, then choose it here. Spotify can't be changed on this read-only drive.", reason: "read_only")
        }
        guard InstallerDiscovery.spotifyPrepared(paths.prefs) else {
            throw InstallerFailure(message: "Open Spotify, sign in, and leave it open for at least a minute. Then return here and try again.", reason: "spotify_unprepared")
        }
        for path in paths.protectedPaths where InstallerFiles.exists(path) {
            if try files.attributesOfItem(atPath: path.path)[.type] as? FileAttributeType == .typeSymbolicLink {
                writeLog("Cannot safely snapshot a linked installation target: \(path.path)")
                throw InstallerFailure(message: "Your setup uses a linked folder or file that can't be safely backed up. Nothing has changed. View details for help.")
            }
        }
        guard paths.config.path.hasPrefix("/"), paths.state.path.hasPrefix("/") else {
            throw InstallerFailure(message: "Your Spicetify location couldn't be read. Open Spicetify once and try again.")
        }
    }

    func release(_ repository: String, version: String? = nil) throws -> Release {
        let destination = work.appendingPathComponent("release-\(UUID().uuidString).json")
        let endpoint = URL(string: "https://api.github.com/repos/\(repository)/releases")!
        let url = repository == "alexk218/tagify"
            ? URL(string: "https://tagify.fm/releases/client/" + (version.map { "v" + $0 + "/release.json" } ?? "latest.json"))!
            : version.map { endpoint.appendingPathComponent("tags").appendingPathComponent("v" + $0) } ?? endpoint.appendingPathComponent("latest")
        try download(url, destination)
        return try JSONDecoder().decode(Release.self, from: Data(contentsOf: destination))
    }

    static func verify(_ file: URL, digest: String) throws {
        let hash = SHA256.hash(data: try Data(contentsOf: file, options: .mappedIfSafe)).map { String(format: "%02x", $0) }.joined()
        guard digest.lowercased() == "sha256:\(hash)" else {
            throw InstallerFailure(message: "The download couldn't be verified. Nothing has been installed. Try again.", reason: "download_verification")
        }
    }

    static func validateArchiveListing(names: String, details: String) throws {
        let entries = names.split(separator: "\n")
        guard !entries.isEmpty, entries.allSatisfy({ entry in
            !entry.hasPrefix("/") && !entry.contains("\\") && !entry.split(separator: "/").contains("..")
        }), details.split(separator: "\n").allSatisfy({ $0.hasPrefix("-") || $0.hasPrefix("d") }) else {
            throw InstallerFailure(message: "The download couldn't be opened safely. Nothing has been installed. Try again later.", reason: "archive_invalid")
        }
    }

    private func unpack(_ asset: Release.Asset, label: String) throws -> URL {
        let archive = work.appendingPathComponent("\(UUID().uuidString)-\(asset.name)")
        try InstallerDiskSpace.check([.init(path: work, bytes: max(InstallerDiskSpace.reserve, asset.size ?? 0))], volume: diskVolume)
        try download(asset.browser_download_url, archive)
        try Self.verify(archive, digest: asset.digest ?? "")
        let names = try run("/usr/bin/tar", ["-tf", archive.path], failure: "The download couldn't be opened. Try again.")
        let details = try run("/usr/bin/tar", ["-tvf", archive.path, "--numeric-owner"], failure: "The download couldn't be opened. Try again.")
        try Self.validateArchiveListing(names: names, details: details)
        try InstallerDiskSpace.check([.init(path: work, bytes: InstallerDiskSpace.expandedArchiveBytes(details))], volume: diskVolume)
        let folder = work.appendingPathComponent("\(label)-\(UUID().uuidString)")
        try files.createDirectory(at: folder, withIntermediateDirectories: true)
        try run("/usr/bin/tar", ["-xf", archive.path, "-C", folder.path, "--no-same-owner", "--no-same-permissions"], failure: "The download couldn't be opened. Try again.")
        return folder
    }

    @discardableResult
    private func run(_ executable: String, _ arguments: [String], failure: String) throws -> String {
        writeLog("Running \(executable) \(arguments.joined(separator: " "))")
        let result = try command(URL(fileURLWithPath: executable), arguments, environment)
        writeLog(result.output)
        guard result.status == 0 else { throw InstallerFailure(message: failure) }
        return result.output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func spice(_ arguments: [String]) throws {
        try run(paths.binary.path, ["--no-restart"] + arguments,
                failure: "Spotify couldn't be updated. Check that Spotify is closed and try again. If this continues, Spotify may need a newer Spicetify update.")
    }

    private func setSpotifyUpdates(blocked: Bool) throws {
        let failure = blocked
            ? "Spotify updates couldn't be blocked. Uncheck Block Spotify updates and try again."
            : "Spotify updates couldn't be enabled. Open the installation log for help, then try again."
        do {
            try run(paths.binary.path, ["--no-restart", "spotify-updates", blocked ? "block" : "unblock"], failure: failure)
            // On macOS the CLI ignores mkdir/chflags failures and can still exit successfully.
            // Check the actual immutable flag instead of trusting its success message.
            guard let flags = try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates),
                  (flags & UInt32(UF_IMMUTABLE) != 0) == blocked else {
                throw InstallerFailure(message: failure)
            }
            if blocked { try SpotifyUpdateState.verifyBlocked(paths.spotifyUpdates) }
        } catch {
            writeLog("Spotify update setting failed: \(error)")
            throw InstallerFailure(message: failure)
        }
    }

    func applySpotifyUpdateSetting(blocked: Bool) throws {
        var lock: Int32 = -1
        defer { if lock >= 0 { flock(lock, LOCK_UN); Darwin.close(lock) } }
        guard getuid() != 0 else { throw InstallerFailure(message: "Open Tagify Manager from Finder using your own Mac account.") }
        if blocked {
            try preflight()
            guard files.isExecutableFile(atPath: paths.binary.path) else {
                throw InstallerFailure(message: "Install Tagify first, then apply this change.")
            }
        }
        try files.createDirectory(at: paths.backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        lock = Darwin.open(paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else {
            throw InstallerFailure(message: "Another Tagify installation is running. Wait for it to finish and try again.", reason: "busy")
        }
        try requireNoPendingRecovery()
        pruneBackups()
        if blocked {
            if try SpotifyUpdateState.isBlocked(paths.spotifyUpdates) {
                try SpotifyUpdateState.verifyBlocked(paths.spotifyUpdates)
                return
            }
        } else if ((try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates)) ?? 0) & UInt32(UF_IMMUTABLE) == 0 { return }
        try InstallerDiskSpace.check([.init(path: paths.backups, bytes: Int64(64 * 1024))], reserve: Int64(64 * 1024), volume: diskVolume)
        let backup = paths.backups.appendingPathComponent("update-setting-\(UUID().uuidString)")
        try files.createDirectory(at: backup, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let before = try SpotifyUpdateState(directory: paths.spotifyUpdates, backup: backup)
        try JSONEncoder().encode(before).write(to: backup.appendingPathComponent("spotify-updates.json"), options: .atomic)
        backupURL = backup
        var journal = InstallJournal(spotify: paths.spotify, updateState: before)
        try journal.save(in: backup)
        do {
            // Quitting Spotify may hand off a cached update. Protect staging before that handoff.
            if blocked { try before.prepareForBlock() }
            try closeSpotify()
            if blocked { try setSpotifyUpdates(blocked: true) }
            else {
                if let flags = try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates) {
                    try changeUpdateFlags(paths.spotifyUpdates, flags & ~UInt32(UF_IMMUTABLE))
                }
                guard ((try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates)) ?? 0) & UInt32(UF_IMMUTABLE) == 0 else {
                    throw InstallerFailure(message: "Spotify updates are still blocked. View details for help, then try again.")
                }
            }
            journal.status = .committed
            try journal.save(in: backup)
            pruneBackups()
            writeLog("Spotify updates are \(blocked ? "blocked" : "allowed").")
        } catch {
            writeLog("Update setting failed: \(error)")
            do {
                try before.restore()
                journal.status = .restored
                try journal.save(in: backup)
            }
            catch {
                writeLog("Update setting restore failed: \(error)")
                throw InstallerFailure(message: "The update setting couldn't be restored. View details for help, then try again.")
            }
            throw error
        }
    }

    private func requireNoPendingRecovery() throws {
        guard try InstallJournal.pending(in: paths.backups).isEmpty else {
            throw InstallerFailure(message: "A previous setup was interrupted. Restore your previous setup before trying again.", reason: "recovery_required")
        }
    }

    private func pruneBackups() {
        do { try InstallerBackupRetention.prune(in: paths.backups, log: writeLog) }
        catch { writeLog("Backup cleanup deferred: \(error)") }
    }

    func recoverInterruptedInstallation() throws {
        guard getuid() != 0 else { throw InstallerFailure(message: "Open Tagify Manager from Finder using your own Mac account.") }
        try files.createDirectory(at: paths.backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let lock = Darwin.open(paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
        defer { if lock >= 0 { flock(lock, LOCK_UN); Darwin.close(lock) } }
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else {
            throw InstallerFailure(message: "Another Tagify installation is running. Wait for it to finish and try again.", reason: "busy")
        }
        let pending = try InstallJournal.pending(in: paths.backups)
        for (backup, record) in pending {
            guard record.spotify.standardizedFileURL.path == paths.spotify.standardizedFileURL.path,
                  record.updateState.directory.standardizedFileURL.path == paths.spotifyUpdates.standardizedFileURL.path,
                  record.updateState.pendingDirectory == nil || record.updateState.pendingDirectory?.standardizedFileURL.path == backup.appendingPathComponent("pending-spotify-update").standardizedFileURL.path else {
                throw InstallerFailure(message: "Choose the Spotify copy used by your interrupted setup, then try restoring again. View details for help.")
            }
            // A crash may remove the managed CLI before its replacement arrives. Discovery
            // can then find Homebrew; the original private runtime is still a valid restore target.
            let recoveryPaths = paths.protectedPaths + [paths.home.appendingPathComponent(".spicetify")]
            let snapshot = try record.hasSnapshot ? InstallSnapshot(directory: backup, allowedPaths: recoveryPaths) : nil
            try snapshot?.validate()
            if let snapshot = snapshot {
                try InstallerDiskSpace.check(try snapshot.entries.filter(\.existed).map { .init(path: $0.original, bytes: try InstallerDiskSpace.size($0.saved)) }, reserve: Int64(64 * 1024 * 1024), volume: diskVolume)
            }
            backupURL = backup
            try closeSpotify()
            if snapshot != nil && !files.isWritableFile(atPath: paths.resources.path) { try authorizeSpotify(paths.resources) }
            // Restore app files before allowing a previously queued Spotify update again.
            try snapshot?.restore()
            try record.updateState.restore()
            var finished = record
            finished.status = .restored
            try finished.save(in: backup)
            writeLog("Restored interrupted setup from \(backup.path)")
        }
        pruneBackups()
    }

    private func bootstrap(_ folder: URL) throws {
        let keyDirectory = paths.key.deletingLastPathComponent()
        try files.createDirectory(at: keyDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var key = (try? String(contentsOf: paths.key, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if key.range(of: #"^tgfy_install_[A-Za-z0-9_-]{43}$"#, options: .regularExpression) == nil {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                throw InstallerFailure(message: "Tagify couldn't finish setting up. Restart the installer and try again.")
            }
            key = "tgfy_install_" + Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            try Data("\(key)\n".utf8).write(to: paths.key, options: .atomic)
        }
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: paths.key.path)
        let extensionFile = folder.appendingPathComponent("extension.js")
        var contents = Data("globalThis.__tagifyInstallRecoveryKey=\"\(key)\";\n".utf8)
        let source = try String(contentsOf: extensionFile, encoding: .utf8)
        let clean = source.replacingOccurrences(of: #"^(globalThis\.__tagifyInstallRecoveryKey=\"tgfy_install_[A-Za-z0-9_-]{43}\";\n)+"#, with: "", options: .regularExpression)
        contents.append(Data(clean.utf8))
        try contents.write(to: extensionFile, options: .atomic)
        // Never log the recovery key or the contents of extension.js.
    }

    enum Intent { case update, repair, updateSpicetify }

    func install(architecture: String, blockSpotifyUpdates: Bool = true, intent: Intent = .update) throws -> String {
        var snapshot: InstallSnapshot?
        var updateSnapshot: SpotifyUpdateState?
        var journal: InstallJournal?
        var lock: Int32 = -1
        defer { if lock >= 0 { flock(lock, LOCK_UN); Darwin.close(lock) } }
        do {
            progress(0, "Checking Spotify")
            try preflight()
            // A per-account process lock prevents two installer windows from replacing each other's files.
            try files.createDirectory(at: paths.backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            lock = Darwin.open(paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
            guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else {
                throw InstallerFailure(message: "Another Tagify installation is running. Wait for it to finish and try again.", reason: "busy")
            }
            try requireNoPendingRecovery()
            pruneBackups()
            try InstallerDiskSpace.check(try InstallerDiskSpace.installationNeeds(paths: paths, tagifyBytes: 0, spiceBytes: 0) + [.init(path: work, bytes: InstallerDiskSpace.reserve)], volume: diskVolume)
            progress(1, "Preparing verified installation files")
            let installed = SetupStatus.inspect(paths: paths, command: { executable, args, _ in try self.command(executable, args, self.environment) })
            if paths.spicetifySource != .manager {
                guard installed.spicetifyVersion != nil,
                      TagifyPackage.nonemptyFile(paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js")), intent != .updateSpicetify else {
                    throw InstallerFailure(message: paths.spicetifySource == .homebrew
                        ? "Update or repair Spicetify with Homebrew, then choose Check again. Your Spotify setup has not changed."
                        : "Update or repair your existing Spicetify installation, then choose Check again. Your Spotify setup has not changed.")
                }
            }
            let installedTagify = installed.tagifyVersion.flatMap(InstalledVersion.init)
            if InstallerFiles.exists(paths.tagify.appendingPathComponent("package.json")), installedTagify == nil {
                throw InstallerFailure(message: "Your installed Tagify version couldn't be identified. Nothing has changed. View details for help before replacing it.")
            }
            var tagifyRelease: Release?
            var keepTagify = intent != .update && installedTagify != nil || installedTagify?.prerelease != nil
            if !keepTagify {
                let latest = try release("alexk218/tagify")
                _ = try latest.asset(repository: "alexk218/tagify", architecture: architecture)
                tagifyRelease = latest
                if let current = installedTagify, let target = InstalledVersion(latest.tag_name), current > target { keepTagify = true }
            }
            let appFolder: URL
            let version: String
            if keepTagify, TagifyPackage.valid(at: paths.tagify), let current = installedTagify {
                appFolder = work.appendingPathComponent("retained-tagify-\(UUID().uuidString)")
                try files.copyItem(at: paths.tagify, to: appFolder)
                version = current.string
                writeLog("Keeping installed Tagify \(version).")
            } else {
                if keepTagify, let current = installedTagify {
                    do { tagifyRelease = try release("alexk218/tagify", version: current.string) }
                    catch { throw InstallerFailure(message: "Tagify \(current.string) couldn't be downloaded for repair. Your installed version has been kept. Check your connection or reinstall the same version from its original download.") }
                }
                guard let selected = tagifyRelease, let target = InstalledVersion(selected.tag_name),
                      !keepTagify || target == installedTagify else {
                    throw InstallerFailure(message: "The repair download doesn't match your installed version. Nothing has changed. View details for help.")
                }
                let folder = try unpack(selected.asset(repository: "alexk218/tagify", architecture: architecture, allowPrerelease: keepTagify), label: "tagify-download")
                appFolder = files.fileExists(atPath: folder.appendingPathComponent("tagify").path) ? folder.appendingPathComponent("tagify") : folder
                version = target.string
            }
            guard TagifyPackage.valid(at: appFolder), TagifyPackage.version(at: appFolder) == version else {
                throw InstallerFailure(message: "The Tagify download is incomplete or doesn't match the update. Nothing has changed. Try again later.")
            }
            let currentSpice = installed.spicetifyVersion.flatMap(InstalledVersion.init)
            var keepSpice = paths.spicetifySource != .manager || intent == .repair && currentSpice != nil || currentSpice?.prerelease != nil
            var spiceFolder: URL?
            var spiceVersion = currentSpice?.string ?? ""
            if !keepSpice {
                let selected = try release("spicetify/cli")
                let asset = try selected.asset(repository: "spicetify/cli", architecture: architecture)
                guard let target = InstalledVersion(selected.tag_name) else { throw InstallerFailure(message: "The Spicetify update couldn't be read. Try again later.") }
                keepSpice = currentSpice.map { $0 > target } ?? false
                if !keepSpice {
                    let folder = try unpack(asset, label: "spicetify-download")
                    guard files.isExecutableFile(atPath: folder.appendingPathComponent("spicetify").path) else {
                        throw InstallerFailure(message: "The Spicetify download is incomplete. Nothing has changed. Try again later.")
                    }
                    spiceFolder = folder; spiceVersion = target.string
                }
            }
            if keepSpice, let current = currentSpice,
               !TagifyPackage.nonemptyFile(paths.binary.deletingLastPathComponent().appendingPathComponent("jsHelper/spicetifyWrapper.js")) {
                let selected: Release
                do { selected = try release("spicetify/cli", version: current.string) }
                catch { throw InstallerFailure(message: "Spicetify \(current.string) couldn't be downloaded for repair. Your installed version has been kept. Check your connection and try again.") }
                guard InstalledVersion(selected.tag_name) == current else {
                    throw InstallerFailure(message: "The Spicetify repair download doesn't match your installed version. Nothing has changed.")
                }
                spiceFolder = try unpack(selected.asset(repository: "spicetify/cli", architecture: architecture, allowPrerelease: true), label: "spicetify-repair")
            }
            if let folder = spiceFolder {
                guard files.isExecutableFile(atPath: folder.appendingPathComponent("spicetify").path),
                      TagifyPackage.nonemptyFile(folder.appendingPathComponent("jsHelper/spicetifyWrapper.js")) else {
                    throw InstallerFailure(message: "The Spicetify download is incomplete. Nothing has changed. Try again later.")
                }
            }
            writeLog("Plan: Tagify \(installed.tagifyVersion ?? "not installed") → \(version); Spicetify \(installed.spicetifyVersion ?? "not installed") → \(spiceVersion).")
            try InstallerDiskSpace.check(try InstallerDiskSpace.installationNeeds(paths: paths, tagifyBytes: InstallerDiskSpace.size(appFolder), spiceBytes: spiceFolder.map { try InstallerDiskSpace.size($0) } ?? 0), volume: diskVolume)
            progress(2, "Saving your current setup")
            let backup = paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
            try files.createDirectory(at: backup, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            backupURL = backup
            let updateState = try SpotifyUpdateState(directory: paths.spotifyUpdates, backup: backup)
            updateSnapshot = updateState
            try InstallerFiles.save(updateState, to: backup.appendingPathComponent("spotify-updates.json"))
            journal = InstallJournal(spotify: paths.spotify, updateState: updateState)
            try journal!.save(in: backup)
            if blockSpotifyUpdates { try updateState.prepareForBlock() }
            try closeSpotify()
            let enumerator = files.enumerator(at: paths.resources, includingPropertiesForKeys: nil)
            let writable = files.isWritableFile(atPath: paths.resources.path) && (enumerator?.allObjects as? [URL] ?? []).allSatisfy { files.isWritableFile(atPath: $0.path) }
            if !writable { try authorizeSpotify(paths.resources) }
            snapshot = try InstallSnapshot(directory: backup, paths: paths.protectedPaths)
            journal!.hasSnapshot = true
            try journal!.save(in: backup)
            writeLog("Backup: \(backup.path)")
            progress(3, "Setting up Spicetify")
            if let source = spiceFolder {
                try SpicetifyDistribution.install(from: source, to: paths.binary.deletingLastPathComponent(), log: writeLog)
            }
            let reported = try run(paths.binary.path, ["-v"], failure: "Spicetify couldn't start on this Mac. Try again.")
            guard InstalledVersion(reported) == InstalledVersion(spiceVersion) else {
                throw InstallerFailure(message: "Spicetify couldn't be verified. Try again.", reason: "spicetify_verification")
            }
            progress(4, "Installing Tagify")
            try bootstrap(appFolder)
            try files.createDirectory(at: paths.tagify.deletingLastPathComponent(), withIntermediateDirectories: true)
            if files.fileExists(atPath: paths.tagify.path) { try files.removeItem(at: paths.tagify) }
            try files.copyItem(at: appFolder, to: paths.tagify)
            // Optional historical linking must never block installation or change app consent.
            prepareAnalyticsHandoff(paths.tagify)
            try spice(["config", "spotify_path", paths.resources.path, "prefs_path", paths.prefs.path])
            try spice(["config", "custom_apps", "tagify"])
            progress(5, "Checking Tagify in Spotify")
            // backup handles first installs and Spotify updates; existing installs also need fresh preprocessing
            // after a CLI update. Restore only when the backup matches the installed Spotify version.
            let configText = (try? String(contentsOf: paths.config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
            let backupVersion = Self.iniValue(configText, section: "Backup", key: "version")
            let spotifyVersion = Self.iniValue((try? String(contentsOf: paths.prefs, encoding: .utf8)) ?? "", section: nil, key: "app.last-launched-version")?.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            if let backupVersion = backupVersion, !backupVersion.isEmpty, backupVersion == spotifyVersion,
               [paths.state.appendingPathComponent("Backup/xpui.spa"), paths.state.appendingPathComponent("xpui.spa")].contains(where: { files.fileExists(atPath: $0.path) }) {
                try spice(["restore", "backup", "apply"])
            } else { try spice(["backup", "apply"]) }
            progress(5, blockSpotifyUpdates ? "Blocking Spotify updates" : "Allowing Spotify updates")
            try setSpotifyUpdates(blocked: blockSpotifyUpdates)
            let verified = SetupStatus.inspect(paths: paths, command: { executable, args, _ in try self.command(executable, args, self.environment) })
            guard verified.ready, verified.tagifyVersion == version,
                  InstalledVersion(verified.spicetifyVersion ?? "") == InstalledVersion(spiceVersion),
                  verified.updatesBlocked == blockSpotifyUpdates else {
                throw InstallerFailure(message: "Tagify couldn't be confirmed in Spotify. Your previous setup will be restored. Try again.", reason: "verification")
            }
            journal!.status = .committed
            try journal!.save(in: backup)
            pruneBackups()
            writeLog("RESULT: SUCCESS. Tagify \(version), Spicetify \(reported).")
            progress(6, "Tagify is ready")
            return version
        } catch {
            writeLog("RESULT: FAILED. \(error)")
            if snapshot != nil || updateSnapshot != nil {
                progress(5, "Restoring your previous setup")
                var restoreFailed = false
                do { try snapshot?.restore() }
                catch { restoreFailed = true; writeLog("Restore failed: \(error)") }
                do { try updateSnapshot?.restore() }
                catch { restoreFailed = true; writeLog("Update setting restore failed: \(error)") }
                if restoreFailed {
                    throw InstallerFailure(message: "Setup stopped, and your previous setup couldn't be fully restored. Open the installation log for help. Your saved copy is available in Installer Backups.", reason: "rollback")
                }
                if var record = journal, let backup = backupURL {
                    record.status = .restored
                    try record.save(in: backup)
                }
                writeLog("Previous setup restored.")
            }
            if let failure = error as? InstallerFailure { throw failure }
            throw InstallerFailure(message: "Setup couldn't finish. Check your connection and available disk space, then try again. Open the log if you need help.", reason: InstallerAnalyticsFailure.reason(error))
        }
    }

    static func iniValue(_ text: String, section: String?, key: String) -> String? {
        var current: String?
        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") && trimmed.hasSuffix("]") { current = String(trimmed.dropFirst().dropLast()); continue }
            if trimmed.hasPrefix(";") || trimmed.hasPrefix("#") { continue }
            let pair = trimmed.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            if current == section, pair.count == 2, pair[0].trimmingCharacters(in: .whitespaces) == key {
                return pair[1].trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }
}
