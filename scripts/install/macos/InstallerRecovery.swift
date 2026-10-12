import Foundation
import CryptoKit
import Darwin

enum InstallerFiles {
    static func exists(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0
    }

    static func save<T: Encodable>(_ value: T, to url: URL) throws {
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
        let directory = Darwin.open(url.deletingLastPathComponent().path, O_RDONLY)
        defer { if directory >= 0 { Darwin.close(directory) } }
        if directory >= 0, fsync(directory) != 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }

    static func hash(_ url: URL) throws -> String {
        let files = FileManager.default
        let type = try files.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType
        var hash = SHA256()
        if type == .typeSymbolicLink {
            hash.update(data: Data(("link:" + (try files.destinationOfSymbolicLink(atPath: url.path))).utf8))
        } else if type == .typeDirectory {
            for child in try files.contentsOfDirectory(at: url, includingPropertiesForKeys: nil).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                hash.update(data: Data("\(child.lastPathComponent.utf8.count):\(child.lastPathComponent):\(try Self.hash(child))".utf8))
            }
        } else if type == .typeRegular {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        } else { throw InstallerFailure(message: "Your saved setup couldn't be read. View details for help.") }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // The saved copy remains intact. A same-volume swap never deletes the current
    // copy before its complete replacement is available, even if the process dies.
    static func restore(_ source: URL, to destination: URL) throws {
        let files = FileManager.default
        let parent = destination.deletingLastPathComponent()
        try files.createDirectory(at: parent, withIntermediateDirectories: true)
        let staged = parent.appendingPathComponent(".tagify-restore-\(UUID().uuidString)")
        defer { try? files.removeItem(at: staged) }
        try files.copyItem(at: source, to: staged)
        if exists(destination) {
            guard renameatx_np(AT_FDCWD, staged.path, AT_FDCWD, destination.path, UInt32(RENAME_SWAP)) == 0 else {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
        } else { try files.moveItem(at: staged, to: destination) }
    }
}

struct InstallJournal: Codable {
    enum Status: String, Codable { case active, committed, restored }
    var status: Status = .active
    var hasSnapshot = false
    var retentionVersion: Int? = 1
    var completedAt: Date?
    let spotify: URL
    let updateState: SpotifyUpdateState

    static func location(_ backup: URL) -> URL { backup.appendingPathComponent("operation.json") }
    func save(in backup: URL) throws {
        var saved = self
        if status != .active && saved.completedAt == nil { saved.completedAt = Date() }
        try InstallerFiles.save(saved, to: Self.location(backup))
    }

    static func pending(in backups: URL) throws -> [(URL, InstallJournal)] {
        let files = FileManager.default
        guard files.fileExists(atPath: backups.path) else { return [] }
        return try files.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil).sorted(by: { $0.path < $1.path }).compactMap { folder in
            let journal = Self.location(folder)
            guard InstallerFiles.exists(journal) else { return nil }
            guard try files.attributesOfItem(atPath: journal.path)[.type] as? FileAttributeType == .typeRegular else {
                throw InstallerFailure(message: "A previous setup needs recovery. View details for help before installing again.")
            }
            let record = try JSONDecoder().decode(Self.self, from: Data(contentsOf: journal))
            return record.status == .active ? (folder, record) : nil
        }
    }
}

// Only overwrite bundled customizations that this manager installed and that the
// user has not edited. With no ownership history, preserve existing files.
enum SpicetifyDistribution {
    static func install(from source: URL, to destination: URL, log: (String) -> Void) throws {
        let files = FileManager.default
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        let ownershipURL = destination.appendingPathComponent(".tagify-owned-customizations.json")
        let old = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: ownershipURL))) ?? [:]
        var owned: [String: String] = [:]
        func merge(_ folder: URL, into target: URL, prefix: String) throws {
            if InstallerFiles.exists(target), try files.attributesOfItem(atPath: target.path)[.type] as? FileAttributeType != .typeDirectory {
                log("Preserved customization at \(target.path)"); return
            }
            try files.createDirectory(at: target, withIntermediateDirectories: true)
            for item in try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
                let relative = prefix + "/" + item.lastPathComponent
                let output = target.appendingPathComponent(item.lastPathComponent)
                if try files.attributesOfItem(atPath: item.path)[.type] as? FileAttributeType == .typeDirectory {
                    try merge(item, into: output, prefix: relative)
                } else {
                    if InstallerFiles.exists(output) {
                        guard let previous = old[relative], try InstallerFiles.hash(output) == previous,
                              try files.attributesOfItem(atPath: output.path)[.type] as? FileAttributeType == .typeRegular else {
                            log("Preserved customization at \(output.path)"); continue
                        }
                        try files.removeItem(at: output)
                    }
                    try files.copyItem(at: item, to: output)
                    owned[relative] = try InstallerFiles.hash(output)
                }
            }
        }
        for item in try files.contentsOfDirectory(at: source, includingPropertiesForKeys: nil) {
            let output = destination.appendingPathComponent(item.lastPathComponent)
            if ["Themes", "Extensions", "CustomApps"].contains(item.lastPathComponent) {
                try merge(item, into: output, prefix: item.lastPathComponent)
            } else {
                if InstallerFiles.exists(output) { try files.removeItem(at: output) }
                try files.copyItem(at: item, to: output)
            }
        }
        try InstallerFiles.save(owned, to: ownershipURL)
    }
}
