import Foundation
import Darwin

struct InstallerAnalyticsConfiguration: Codable {
    let token: String
    let host: String
    var endpoint: URL? {
        guard token.range(of: #"^phc_[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil,
              ["https://us.i.posthog.com", "https://eu.i.posthog.com"].contains(host) else { return nil }
        return URL(string: host + "/i/v0/e/")
    }
    static func bundled() -> InstallerAnalyticsConfiguration? {
        guard let url = Bundle.main.url(forResource: "InstallerAnalytics", withExtension: "json"),
              let data = try? Data(contentsOf: url), let result = try? JSONDecoder().decode(Self.self, from: data), result.endpoint != nil else { return nil }
        return result
    }
}

// Explicit events only. No SDK autocapture, account identity, paths, or raw errors.
final class InstallerAnalytics {
    struct Event: Codable {
        let uuid: UUID
        let event: String
        let timestamp: Date
        let distinctID: UUID
        let properties: [String: String]
    }
    struct State: Codable {
        var enabled = false
        var identity: UUID?
        var opened = false
        var events: [Event] = []
    }
    typealias Transport = (URLRequest, @escaping (Int?, Data?) -> Void) -> (() -> Void)
    static let events: Set<String> = ["installer_opened", "installer_operation_started", "installer_stage_reached", "installer_operation_finished", "installer_help_opened"]
    static let properties: Set<String> = ["platform", "installer_version", "os_version", "architecture", "spotify_version", "spicetify_version", "tagify_version", "spicetify_source", "setup_present", "first_observed_open", "session_id", "operation_id", "operation", "stage", "outcome", "failure_reason", "duration_seconds", "recovery_needed", "help"]
    let configuration: InstallerAnalyticsConfiguration?
    let file: URL
    private let queue = DispatchQueue(label: "fm.tagify.installer.analytics", qos: .utility)
    private let transport: Transport
    private let now: () -> Date
    private var cancel: (() -> Void)?
    private var retry: DispatchWorkItem?
    private var generation = UUID()
    private var sending = false
    private var failures = 0
    private var opened = false
    private let sessionID = UUID()

    init(home: URL, configuration: InstallerAnalyticsConfiguration?, now: @escaping () -> Date = Date.init, transport: Transport? = nil) {
        self.configuration = configuration?.endpoint == nil ? nil : configuration
        file = home.appendingPathComponent("Library/Application Support/Tagify/Installer/analytics.json")
        self.now = now
        self.transport = transport ?? { request, completion in
            let client = AnalyticsHTTPClient()
            let session = URLSession(configuration: .ephemeral, delegate: client, delegateQueue: nil)
            let task = session.dataTask(with: request) { data, response, _ in
                completion((response as? HTTPURLResponse)?.statusCode, data)
                session.finishTasksAndInvalidate()
            }
            task.resume()
            return { task.cancel(); session.invalidateAndCancel() }
        }
    }
    deinit { retry?.cancel(); cancel?() }

    private func read() -> State {
        let attrs: [FileAttributeKey: Any]
        do { attrs = try FileManager.default.attributesOfItem(atPath: file.path) }
        catch {
            let failure = error as NSError
            // Only a missing record gets the new default. Saved opt-outs and unreadable records stay off.
            if failure.domain == NSCocoaErrorDomain && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(failure.code) {
                return State(enabled: configuration != nil)
            }
            return State()
        }
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 256 * 1024,
              let data = try? Data(contentsOf: file), let state = try? JSONDecoder().decode(State.self, from: data) else { return State() }
        return state
    }
    // Nonblocking account lock: another process or a disk problem must not delay setup.
    @discardableResult private func change(_ body: (inout State) -> Void) -> Bool {
        let files = FileManager.default
        do {
            try files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let lock = Darwin.open(file.appendingPathExtension("lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lock >= 0 else { return false }
            defer { Darwin.close(lock) }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { return false }
            defer { flock(lock, LOCK_UN) }
            var state = read()
            body(&state)
            state.events = Array(state.events.filter { now().timeIntervalSince($0.timestamp) < 7 * 86400 }.suffix(200))
            let data = try JSONEncoder().encode(state)
            guard data.count <= 256 * 1024 else { return false }
            try data.write(to: file, options: .atomic)
            try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return true
        } catch { return false }
    }
    var enabled: Bool { queue.sync { configuration != nil && read().enabled } }
    func snapshot() -> State { queue.sync { read() } }
    // A short-lived offer to link past setup, not inherited app consent or global revocation.
    @discardableResult func writeHistoricalHandoff(to app: URL) -> Bool {
        queue.sync {
            let target = app.appendingPathComponent("productAnalyticsBridge.js")
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: target.path),
                  attrs[.type] as? FileAttributeType == .typeRegular,
                  let manifest = try? Data(contentsOf: app.appendingPathComponent("manifest.json")),
                  let object = try? JSONSerialization.jsonObject(with: manifest) as? [String: Any],
                  (object["subfiles_extension"] as? [String])?.contains("productAnalyticsBridge.js") == true else { return false }
            let state = read()
            var bridge: [String: Any] = ["schemaVersion": 2, "enabled": false]
            if configuration != nil, state.enabled, let identity = state.identity {
                bridge["enabled"] = true
                bridge["installationId"] = identity.uuidString
                bridge["expiresAt"] = ISO8601DateFormatter().string(from: now().addingTimeInterval(7 * 86400))
            }
            guard let data = try? JSONSerialization.data(withJSONObject: bridge, options: [.sortedKeys]),
                  let json = String(data: data, encoding: .utf8) else { return false }
            do {
                try Data("window.__tagifyInstallerAnalyticsV1 = \(json);\n".utf8).write(to: target, options: .atomic)
                return true
            } catch { return false }
        }
    }
    @discardableResult func setEnabled(_ value: Bool) -> Bool {
        queue.sync {
            generation = UUID(); cancel?(); cancel = nil; retry?.cancel(); retry = nil; sending = false; failures = 0
            opened = false
            guard !value || configuration != nil else { return false }
            return change { state in
                if value { state.enabled = true; state.identity = state.identity ?? UUID() }
                else { state = State() }
            }
        }
    }
    func opened(properties: [String: String]) {
        queue.async {
            guard !self.opened, self.configuration != nil, self.read().enabled else { return }
            let saved = self.change { state in
                guard state.enabled else { return }
                var props = properties
                props["first_observed_open"] = state.opened ? "false" : "true"
                self.append("installer_opened", properties: props, to: &state)
                state.opened = true
            }
            if saved && self.read().enabled { self.opened = true; self.flush() }
        }
    }
    func capture(_ event: String, properties: [String: String]) {
        queue.async {
            guard self.configuration != nil, Self.events.contains(event), self.read().enabled else { return }
            if self.change({ state in self.append(event, properties: properties, to: &state) }) { self.flush() }
        }
    }
    private func append(_ event: String, properties: [String: String], to state: inout State) {
        guard state.enabled else { return }
        let identity = state.identity ?? UUID(); state.identity = identity
        var safe = properties.filter { Self.properties.contains($0.key) && $0.value.utf8.count <= 100 && $0.value.range(of: #"^[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil }
        safe["platform"] = "macos"; safe["session_id"] = sessionID.uuidString
        state.events.append(Event(uuid: UUID(), event: event, timestamp: now(), distinctID: identity, properties: safe))
    }
    // One persisted batch in flight. Retries reuse event UUIDs and original timestamps.
    private func flush() {
        guard !sending, retry == nil, let config = configuration, config.endpoint != nil else { return }
        guard change({ _ in }) else { return }
        let state = read()
        guard state.enabled, !state.events.isEmpty else { return }
        let batch = Array(state.events.prefix(20))
        let events: [[String: Any]] = batch.map { event in
            var props: [String: Any] = event.properties
            if let duration = event.properties["duration_seconds"], let number = Double(duration) { props["duration_seconds"] = number }
            props["$process_person_profile"] = false; props["$geoip_disable"] = true; props["$ip"] = NSNull()
            return ["uuid": event.uuid.uuidString, "event": event.event, "timestamp": ISO8601DateFormatter().string(from: event.timestamp), "distinct_id": event.distinctID.uuidString, "properties": props]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["api_key": config.token, "batch": events]) else { return }
        var request = URLRequest(url: URL(string: config.host + "/batch/")!)
        // Use the approved ingestion origin; never forward analytics on redirects.
        request.httpMethod = "POST"; request.httpBody = data; request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("TagifyManager", forHTTPHeaderField: "User-Agent")
        let currentGeneration = generation
        sending = true
        cancel = transport(request) { [weak self] status, response in
            guard let self = self else { return }
            self.queue.async {
                guard self.generation == currentGeneration else { return }
                self.sending = false; self.cancel = nil
                let body = response.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                let limited = (body?["quota_limited"] as? [String])?.isEmpty == false
                let accepted = body?["status"] as? Int == 1 || body?["status"] as? String == "Ok"
                if status == 200 && accepted && !limited {
                    let ids = Set(batch.map(\.uuid))
                    if self.change({ $0.events.removeAll { ids.contains($0.uuid) } }) { self.failures = 0; self.flush(); return }
                }
                self.failures = min(self.failures + 1, 8)
                let work = DispatchWorkItem { [weak self] in self?.retry = nil; self?.flush() }
                self.retry = work
                self.queue.asyncAfter(deadline: .now() + min(3600, pow(2, Double(self.failures)) * 15), execute: work)
            }
        }
    }
}

private final class AnalyticsHTTPClient: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

enum InstallerAnalyticsFailure {
    static func reason(_ error: Error) -> String {
        if let failure = error as? InstallerFailure { return failure.reason }
        let error = error as NSError
        if error.domain == NSURLErrorDomain { return "network" }
        if error.domain == NSCocoaErrorDomain && [NSFileWriteOutOfSpaceError].contains(error.code) { return "disk_space" }
        if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOSPC) { return "disk_space" }
        return "unexpected"
    }
}
