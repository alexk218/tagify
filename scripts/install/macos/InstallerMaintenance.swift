import Foundation
import Darwin

struct InstallerVolume {
    let id: String
    let name: String
    let available: Int64
}

enum InstallerDiskSpace {
    static let reserve: Int64 = 512 * 1024 * 1024
    struct Need { let path: URL; let bytes: Int64 }

    static func volume(at path: URL) throws -> InstallerVolume {
        var existing = path
        while !FileManager.default.fileExists(atPath: existing.path), existing.path != "/" { existing.deleteLastPathComponent() }
        let resolved = existing.resolvingSymlinksInPath()
        var info = stat()
        guard stat(resolved.path, &info) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let attributes = try FileManager.default.attributesOfFileSystem(forPath: resolved.path)
        guard let available = attributes[.systemFreeSize] as? NSNumber else {
            throw InstallerFailure(message: "Available disk space couldn't be checked. Reconnect the drive and try again.")
        }
        let name = (try? resolved.resourceValues(forKeys: [.volumeNameKey]).volumeName) ?? "your drive"
        return InstallerVolume(id: String(info.st_dev), name: name, available: available.int64Value)
    }

    static func size(_ path: URL) throws -> Int64 {
        guard InstallerFiles.exists(path) else { return 0 }
        let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
        if attributes[.type] as? FileAttributeType == .typeDirectory {
            return try FileManager.default.contentsOfDirectory(at: path, includingPropertiesForKeys: nil)
                .reduce(Int64(4096)) { try adding($0, size($1)) }
        }
        // Count logical bytes, not APFS clone savings, and never follow symbolic links.
        return max(4096, (attributes[.size] as? NSNumber)?.int64Value ?? 0)
    }

    static func adding(_ a: Int64, _ b: Int64) throws -> Int64 {
        let sum = a.addingReportingOverflow(b)
        guard a >= 0, b >= 0, !sum.overflow else { throw InstallerFailure(message: "The space needed for this setup couldn't be calculated. View details for help.") }
        return sum.partialValue
    }

    // BSD tar with --numeric-owner has fixed mode/link/uid/gid/size columns.
    // Names may contain spaces; they are deliberately not used for this estimate.
    static func expandedArchiveBytes(_ listing: String) throws -> Int64 {
        try listing.split(separator: "\n").reduce(Int64(0)) { total, line in
            let fields = line.split(whereSeparator: \.isWhitespace)
            guard fields.count >= 6, let bytes = Int64(fields[4]), bytes >= 0 else {
                throw InstallerFailure(message: "The space needed to open this download couldn't be checked. Nothing has been installed. Try again later.")
            }
            return try adding(total, max(4096, bytes))
        }
    }

    static func check(_ needs: [Need], reserve: Int64 = reserve, volume: (URL) throws -> InstallerVolume) throws {
        var totals: [String: (InstallerVolume, Int64)] = [:]
        for need in needs {
            let drive = try volume(need.path)
            totals[drive.id] = (drive, try adding(totals[drive.id]?.1 ?? reserve, need.bytes))
        }
        for (_, entry) in totals.sorted(by: { $0.key < $1.key }) where entry.0.available < entry.1 {
            let required = ByteCountFormatter.string(fromByteCount: entry.1, countStyle: .file)
            let free = ByteCountFormatter.string(fromByteCount: max(0, entry.0.available), countStyle: .file)
            throw InstallerFailure(message: "Not enough free space on \(entry.0.name). Setup needs about \(required) available; \(free) is free. Free up space, then try again.", reason: "disk_space")
        }
    }

    static func installationNeeds(paths: InstallerPaths, tagifyBytes: Int64, spiceBytes: Int64) throws -> [Need] {
        var sizes: [URL: Int64] = [:]
        func measured(_ url: URL) throws -> Int64 {
            if let cached = sizes[url] { return cached }
            let bytes = try size(url); sizes[url] = bytes; return bytes
        }
        let snapshots = try paths.protectedPaths.reduce(Int64(0)) { try adding($0, measured($1)) }
        let spotify = try adding(measured(paths.resources.appendingPathComponent("Apps")), measured(paths.resources.appendingPathComponent("xpui.spa")))
        // Budget full backup copies, replacement files, preprocessing, and a staged rollback.
        var result = [Need(path: paths.backups, bytes: try adding(snapshots, measured(paths.spotifyUpdates))),
                      Need(path: paths.tagify, bytes: try adding(measured(paths.tagify), tagifyBytes)),
                      Need(path: paths.state, bytes: try adding(measured(paths.state), adding(spotify, spotify))),
                      Need(path: paths.resources, bytes: try adding(adding(spotify, spotify), tagifyBytes))]
        if paths.spicetifySource == .manager { result.append(Need(path: paths.binary, bytes: try adding(measured(paths.binary.deletingLastPathComponent()), spiceBytes))) }
        return result
    }
}

enum InstallerBackupRetention {
    // Called only while holding the account installation lock. Unknown/older records
    // and unfinished operations are never candidates for automatic deletion.
    static func prune(in directory: URL, keeping count: Int = 3, log: (String) -> Void) throws {
        let files = FileManager.default
        guard InstallerFiles.exists(directory) else { return }
        var groups: [String: [(URL, Date)]] = [:]
        for folder in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            guard try files.attributesOfItem(atPath: folder.path)[.type] as? FileAttributeType == .typeDirectory else { continue }
            let prefix = folder.lastPathComponent.hasPrefix("setup-") ? "setup-" : "update-setting-"
            guard folder.lastPathComponent.hasPrefix(prefix), UUID(uuidString: String(folder.lastPathComponent.dropFirst(prefix.count))) != nil,
                  (try? files.attributesOfItem(atPath: InstallJournal.location(folder).path)[.type] as? FileAttributeType) == .typeRegular,
                  let data = try? Data(contentsOf: InstallJournal.location(folder)),
                  let record = try? JSONDecoder().decode(InstallJournal.self, from: data),
                  record.retentionVersion == 1, record.status != .active, let date = record.completedAt else { continue }
            let allowed = ["operation.json", "restore.json", "spotify-updates.json", "pending-spotify-update"]
            let children = try files.contentsOfDirectory(atPath: folder.path)
            guard children.allSatisfy({ allowed.contains($0) || Int($0) != nil }) else { continue }
            groups[prefix + record.spotify.standardizedFileURL.path, default: []].append((folder, date))
        }
        for entries in groups.values {
            for (folder, _) in entries.sorted(by: { $0.1 == $1.1 ? $0.0.path > $1.0.path : $0.1 > $1.1 }).dropFirst(max(1, count)) {
                do {
                    try unlockTree(folder)
                    try files.removeItem(at: folder)
                    log("Removed older completed backup: \(folder.lastPathComponent)")
                } catch { log("Kept backup after cleanup failure at \(folder.path): \(error)") }
            }
        }
    }

    private static func unlockTree(_ path: URL) throws {
        var info = stat()
        guard lstat(path.path, &info) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        if info.st_mode & S_IFMT == S_IFLNK { return }
        if info.st_flags & UInt32(UF_IMMUTABLE | UF_APPEND) != 0 {
            guard chflags(path.path, info.st_flags & ~UInt32(UF_IMMUTABLE | UF_APPEND)) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        }
        if info.st_mode & S_IFMT == S_IFDIR {
            for child in try FileManager.default.contentsOfDirectory(at: path, includingPropertiesForKeys: nil) { try unlockTree(child) }
        }
    }
}
