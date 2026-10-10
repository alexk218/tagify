import Foundation
import CryptoKit
import Security
import Darwin

struct InstallerFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct Release: Decodable {
    struct Asset: Decodable {
        let name: String
        let browser_download_url: URL
        let digest: String?
    }
    let tag_name: String
    let draft: Bool
    let prerelease: Bool
    let assets: [Asset]

    func asset(repository: String, architecture: String) throws -> Asset {
        guard !draft, !prerelease else {
            throw InstallerFailure(message: "A stable update couldn't be found. Try again later.")
        }
        let version = tag_name.hasPrefix("v") ? String(tag_name.dropFirst()) : tag_name
        let pattern = #"^\d+\.\d+\.\d+$"#
        guard version.range(of: pattern, options: .regularExpression) != nil else {
            throw InstallerFailure(message: "The update information couldn't be read. Try again later.")
        }
        let names = repository == "alexk218/tagify"
            ? ["tagify-\(tag_name).zip", "tagify-\(version).zip", "tagify-\(tag_name)-metadata-corrected.zip"]
            : ["spicetify-\(version)-darwin-\(architecture).tar.gz"]
        guard let asset = assets.first(where: { names.contains($0.name) }),
              asset.browser_download_url.scheme == "https",
              asset.browser_download_url.host == "github.com",
              asset.browser_download_url.path.hasPrefix("/\(repository)/releases/download/\(tag_name)/"),
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
            throw InstallerFailure(message: "Setup took too long. Close Spotify and try again.")
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
        var outcome: Result<Void, Error> = .failure(InstallerFailure(message: "The download took too long. Check your connection and try again."))
        let task = session.downloadTask(with: request) { temporary, response, error in
            defer { complete.signal() }
            do {
                if let error = error { throw error }
                guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let temporary = temporary else {
                    throw InstallerFailure(message: "The download is unavailable. Check your connection and try again later.")
                }
                try FileManager.default.moveItem(at: temporary, to: destination)
                outcome = .success(())
            } catch { outcome = .failure(error) }
        }
        task.resume()
        guard complete.wait(timeout: .now() + 130) == .success else {
            task.cancel()
            throw InstallerFailure(message: "The download took too long. Check your connection and try again.")
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
    let spotify: URL
    var resources: URL { spotify.appendingPathComponent("Contents/Resources") }
    var prefs: URL { home.appendingPathComponent("Library/Application Support/Spotify/prefs") }
    var spotifyUpdates: URL { home.appendingPathComponent("Library/Application Support/Spotify/PersistentCache/Update") }
    var tagify: URL { config.appendingPathComponent("CustomApps/tagify") }
    var key: URL { home.appendingPathComponent(".config/tagify/install-recovery-key") }
    var backups: URL { home.appendingPathComponent("Library/Application Support/Tagify/Installer Backups") }
    var logs: URL { home.appendingPathComponent("Library/Logs/Tagify") }

    init(home: URL = FileManager.default.homeDirectoryForCurrentUser, spotify: URL, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.home = home
        self.spotify = spotify
        config = URL(fileURLWithPath: environment["SPICETIFY_CONFIG"].flatMap { $0.isEmpty ? nil : $0 } ?? home.appendingPathComponent(".config/spicetify").path)
        state = URL(fileURLWithPath: environment["SPICETIFY_STATE"].flatMap { $0.isEmpty ? nil : $0 } ?? home.appendingPathComponent(".local/state/spicetify").path)
        // The CLI treats an explicit override as the exact state folder, while its default adds
        // Backup/Extracted subdirectories. Keep that distinction for existing installations.
        stateOverride = environment["SPICETIFY_STATE"].flatMap { $0.isEmpty ? nil : $0 }
            ?? (home.standardizedFileURL == FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL ? nil : state.path)
        binary = home.appendingPathComponent(".spicetify/spicetify")
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
    }
    let directory: URL
    private(set) var entries: [Entry] = []
    private let files = FileManager.default

    init(directory: URL, paths: [URL]) throws {
        self.directory = directory
        try files.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for (index, path) in paths.enumerated() {
            let saved = directory.appendingPathComponent(String(index))
            let existed = files.fileExists(atPath: path.path)
            if existed { try files.copyItem(at: path, to: saved) }
            entries.append(Entry(original: path, saved: saved, existed: existed))
        }
        try JSONEncoder().encode(entries).write(to: directory.appendingPathComponent("restore.json"), options: .atomic)
    }

    func restore() throws {
        // Attempt every entry, even if one restore fails; retain the backup for manual recovery.
        var failures: [String] = []
        for entry in entries.reversed() {
            do {
                if files.fileExists(atPath: entry.original.path) { try files.removeItem(at: entry.original) }
                if entry.existed {
                    try files.createDirectory(at: entry.original.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try files.copyItem(at: entry.saved, to: entry.original)
                }
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
    var authorizeSpotify: (URL) throws -> Void = { _ in
        throw InstallerFailure(message: "Spotify can't be updated here. Choose a writable copy of Spotify and try again.")
    }
    var command: (URL, [String], [String: String]) throws -> CommandResult = InstallerSystem.run
    var download: (URL, URL) throws -> Void = InstallerSystem.download
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
            throw InstallerFailure(message: "Open Tagify Installer normally from Finder, using your own Mac account.")
        }
        let info = paths.spotify.appendingPathComponent("Contents/Info.plist")
        guard let plist = NSDictionary(contentsOf: info), plist["CFBundleIdentifier"] as? String == "com.spotify.client",
              files.fileExists(atPath: paths.resources.appendingPathComponent("Apps").path) else {
            throw InstallerFailure(message: "Choose the Spotify desktop app. If it isn't installed, download it from spotify.com/download first.")
        }
        guard files.fileExists(atPath: paths.prefs.path) else {
            throw InstallerFailure(message: "Open Spotify, sign in, and leave it open for at least a minute. Then return here and try again.")
        }
        guard paths.config.path.hasPrefix("/"), paths.state.path.hasPrefix("/") else {
            throw InstallerFailure(message: "Your Spicetify location couldn't be read. Open Spicetify once and try again.")
        }
    }

    func release(_ repository: String) throws -> Release {
        let destination = work.appendingPathComponent("release-\(UUID().uuidString).json")
        try download(URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!, destination)
        return try JSONDecoder().decode(Release.self, from: Data(contentsOf: destination))
    }

    static func verify(_ file: URL, digest: String) throws {
        let hash = SHA256.hash(data: try Data(contentsOf: file, options: .mappedIfSafe)).map { String(format: "%02x", $0) }.joined()
        guard digest.lowercased() == "sha256:\(hash)" else {
            throw InstallerFailure(message: "The download couldn't be verified. Nothing has been installed. Try again.")
        }
    }

    static func validateArchiveListing(names: String, details: String) throws {
        let entries = names.split(separator: "\n")
        guard !entries.isEmpty, entries.allSatisfy({ entry in
            !entry.hasPrefix("/") && !entry.contains("\\") && !entry.split(separator: "/").contains("..")
        }), details.split(separator: "\n").allSatisfy({ $0.hasPrefix("-") || $0.hasPrefix("d") }) else {
            throw InstallerFailure(message: "The download couldn't be opened safely. Nothing has been installed. Try again later.")
        }
    }

    private func unpack(_ asset: Release.Asset, label: String) throws -> URL {
        let archive = work.appendingPathComponent("\(UUID().uuidString)-\(asset.name)")
        try download(asset.browser_download_url, archive)
        try Self.verify(archive, digest: asset.digest ?? "")
        let names = try run("/usr/bin/tar", ["-tf", archive.path], failure: "The download couldn't be opened. Try again.")
        let details = try run("/usr/bin/tar", ["-tvf", archive.path], failure: "The download couldn't be opened. Try again.")
        try Self.validateArchiveListing(names: names, details: details)
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
        try preflight()
        guard files.isExecutableFile(atPath: paths.binary.path) else {
            throw InstallerFailure(message: "Install Tagify first, then apply this change.")
        }
        try files.createDirectory(at: paths.backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        lock = Darwin.open(paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else {
            throw InstallerFailure(message: "Another Tagify installation is running. Wait for it to finish and try again.")
        }
        if blocked {
            if try SpotifyUpdateState.isBlocked(paths.spotifyUpdates) {
                try SpotifyUpdateState.verifyBlocked(paths.spotifyUpdates)
                return
            }
        } else if ((try SpotifyUpdateState.directoryFlags(paths.spotifyUpdates)) ?? 0) & UInt32(UF_IMMUTABLE) == 0 { return }
        let backup = paths.backups.appendingPathComponent("update-setting-\(UUID().uuidString)")
        try files.createDirectory(at: backup, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let before = try SpotifyUpdateState(directory: paths.spotifyUpdates, backup: backup)
        try JSONEncoder().encode(before).write(to: backup.appendingPathComponent("spotify-updates.json"), options: .atomic)
        backupURL = backup
        do {
            // Quitting Spotify may hand off a cached update. Protect staging before that handoff.
            if blocked { try before.prepareForBlock() }
            try closeSpotify()
            try setSpotifyUpdates(blocked: blocked)
            writeLog("Spotify updates are \(blocked ? "blocked" : "allowed").")
        } catch {
            writeLog("Update setting failed: \(error)")
            do { try before.restore() }
            catch {
                writeLog("Update setting restore failed: \(error)")
                throw InstallerFailure(message: "The update setting couldn't be restored. View details for help, then try again.")
            }
            throw error
        }
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
        contents.append(try Data(contentsOf: extensionFile))
        try contents.write(to: extensionFile, options: .atomic)
        // Never log the recovery key or the contents of extension.js.
    }

    func install(architecture: String, blockSpotifyUpdates: Bool = true) throws -> String {
        var snapshot: InstallSnapshot?
        var updateSnapshot: SpotifyUpdateState?
        var lock: Int32 = -1
        defer { if lock >= 0 { flock(lock, LOCK_UN); Darwin.close(lock) } }
        do {
            progress(0, "Checking Spotify")
            try preflight()
            // A per-account process lock prevents two installer windows from replacing each other's files.
            try files.createDirectory(at: paths.backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            lock = Darwin.open(paths.backups.appendingPathComponent(".install.lock").path, O_CREAT | O_RDWR, 0o600)
            guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else {
                throw InstallerFailure(message: "Another Tagify installation is running. Wait for it to finish and try again.")
            }
            progress(1, "Downloading verified updates")
            let tagifyRelease = try release("alexk218/tagify")
            let spiceRelease = try release("spicetify/cli")
            let tagifyFolder = try unpack(tagifyRelease.asset(repository: "alexk218/tagify", architecture: architecture), label: "tagify-download")
            let spiceFolder = try unpack(spiceRelease.asset(repository: "spicetify/cli", architecture: architecture), label: "spicetify-download")
            let appFolder = files.fileExists(atPath: tagifyFolder.appendingPathComponent("tagify").path)
                ? tagifyFolder.appendingPathComponent("tagify") : tagifyFolder
            for name in ["index.js", "extension.js", "style.css", "manifest.json", "package.json"] {
                guard files.fileExists(atPath: appFolder.appendingPathComponent(name).path) else {
                    throw InstallerFailure(message: "The Tagify download is incomplete. Nothing has been installed. Try again later.")
                }
            }
            let package = try JSONSerialization.jsonObject(with: Data(contentsOf: appFolder.appendingPathComponent("package.json"))) as? [String: Any]
            let version = String(tagifyRelease.tag_name.drop(while: { $0 == "v" }))
            guard package?["version"] as? String == version,
                  files.isExecutableFile(atPath: spiceFolder.appendingPathComponent("spicetify").path) else {
                throw InstallerFailure(message: "The download doesn't match the update. Nothing has been installed. Try again later.")
            }
            progress(2, "Saving your current setup")
            let backup = paths.backups.appendingPathComponent("setup-\(UUID().uuidString)")
            try files.createDirectory(at: backup, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            backupURL = backup
            let updateState = try SpotifyUpdateState(directory: paths.spotifyUpdates, backup: backup)
            updateSnapshot = updateState
            try JSONEncoder().encode(updateState).write(to: backup.appendingPathComponent("spotify-updates.json"), options: .atomic)
            if blockSpotifyUpdates { try updateState.prepareForBlock() }
            try closeSpotify()
            let enumerator = files.enumerator(at: paths.resources, includingPropertiesForKeys: nil)
            let writable = files.isWritableFile(atPath: paths.resources.path) && (enumerator?.allObjects as? [URL] ?? []).allSatisfy { files.isWritableFile(atPath: $0.path) }
            if !writable { try authorizeSpotify(paths.resources) }
            let protected = [paths.tagify, paths.config.appendingPathComponent("config-xpui.ini"),
                             paths.binary.deletingLastPathComponent(), paths.state,
                             paths.config.appendingPathComponent("Backup"), paths.config.appendingPathComponent("Extracted"),
                             paths.resources.appendingPathComponent("Apps"), paths.resources.appendingPathComponent("xpui.spa")]
            // Some older installations put state and config in the same folder. Avoid overlapping snapshots.
            let distinct = protected.filter { candidate in
                !protected.contains { $0 != candidate && candidate.path.hasPrefix($0.path + "/") }
            }
            snapshot = try InstallSnapshot(directory: backup, paths: Array(Set(distinct)))
            writeLog("Backup: \(backup.path)")
            progress(3, "Setting up Spicetify")
            let binaryFolder = paths.binary.deletingLastPathComponent()
            try files.createDirectory(at: binaryFolder, withIntermediateDirectories: true)
            // Use the full release, including its matching jsHelper files; leave themes and extensions alone.
            for source in try files.contentsOfDirectory(at: spiceFolder, includingPropertiesForKeys: nil) {
                let destination = binaryFolder.appendingPathComponent(source.lastPathComponent)
                if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
                try files.copyItem(at: source, to: destination)
            }
            let reported = try run(paths.binary.path, ["-v"], failure: "Spicetify couldn't start on this Mac. Try again.")
            guard reported == spiceRelease.tag_name.replacingOccurrences(of: "v", with: "") else {
                throw InstallerFailure(message: "Spicetify couldn't be verified. Try again.")
            }
            progress(4, "Installing Tagify")
            try bootstrap(appFolder)
            try files.createDirectory(at: paths.tagify.deletingLastPathComponent(), withIntermediateDirectories: true)
            if files.fileExists(atPath: paths.tagify.path) { try files.removeItem(at: paths.tagify) }
            try files.copyItem(at: appFolder, to: paths.tagify)
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
            let appliedConfig = try String(contentsOf: paths.config.appendingPathComponent("config-xpui.ini"), encoding: .utf8)
            guard Self.iniValue(appliedConfig, section: "AdditionalOptions", key: "custom_apps")?.split(separator: "|").map({ $0.trimmingCharacters(in: .whitespaces) }).contains("tagify") == true,
                  files.fileExists(atPath: paths.resources.appendingPathComponent("Apps/xpui/spicetify-routes-tagify.js").path),
                  files.fileExists(atPath: paths.resources.appendingPathComponent("Apps/xpui/extensions/tagify/extension.js").path) else {
                throw InstallerFailure(message: "Tagify couldn't be confirmed in Spotify. Try again.")
            }
            progress(5, blockSpotifyUpdates ? "Blocking Spotify updates" : "Allowing Spotify updates")
            try setSpotifyUpdates(blocked: blockSpotifyUpdates)
            writeLog("RESULT: SUCCESS. Tagify \(version), Spicetify \(reported).")
            progress(6, "Tagify is ready")
            return version
        } catch {
            writeLog("RESULT: FAILED. \(error)")
            if snapshot != nil || updateSnapshot != nil {
                progress(5, "Restoring your previous setup")
                var restoreFailed = false
                do { try updateSnapshot?.restore() }
                catch { restoreFailed = true; writeLog("Update setting restore failed: \(error)") }
                do { try snapshot?.restore() }
                catch { restoreFailed = true; writeLog("Restore failed: \(error)") }
                if restoreFailed {
                    throw InstallerFailure(message: "Setup stopped, and your previous setup couldn't be fully restored. Open the installation log for help. Your saved copy is available in Installer Backups.")
                }
                writeLog("Previous setup restored.")
            }
            if let failure = error as? InstallerFailure { throw failure }
            throw InstallerFailure(message: "Setup couldn't finish. Check your connection and available disk space, then try again. Open the log if you need help.")
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
