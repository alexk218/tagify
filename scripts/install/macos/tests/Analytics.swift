import Foundation
import Darwin

func testAnalytics() throws {
    let root = files.temporaryDirectory.appendingPathComponent("tagify-analytics-tests-\(UUID())")
    defer { try? files.removeItem(at: root) }
    let config = InstallerAnalyticsConfiguration(token: "phc_test", host: "https://us.i.posthog.com")
    var requests: [URLRequest] = []
    var callbacks: [(Int?, Data?) -> Void] = []
    var cancellations = 0
    let transport: InstallerAnalytics.Transport = { request, callback in
        requests.append(request); callbacks.append(callback)
        return { cancellations += 1 }
    }
    let analytics = InstallerAnalytics(home: root, configuration: config, transport: transport)
    try expect(analytics.enabled && analytics.snapshot().events.isEmpty && requests.isEmpty, "New installation requires analytics opt-in")
    try expect(!files.fileExists(atPath: analytics.file.path), "Reading the default wrote an identity")
    analytics.opened(properties: ["installer_version": "1.2.3", "raw_log": "secret", "spotify_version": "/Users/private"])
    analytics.opened(properties: [:])
    let initial = analytics.snapshot()
    try expect(initial.events.count == 1 && requests.count == 1, "A refresh duplicated the launch event")
    try expect(initial.events[0].properties["first_observed_open"] == "true", "First launch wasn't identified")
    try expect(initial.events[0].properties["raw_log"] == nil && initial.events[0].properties["spotify_version"] == nil, "Private properties entered the queue")
    let payload = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String: Any]
    let event = (payload["batch"] as! [[String: Any]])[0]
    let props = event["properties"] as! [String: Any]
    try expect(props["$process_person_profile"] as? Bool == false && props["$geoip_disable"] as? Bool == true && props["$ip"] is NSNull, "Payload allowed a person profile or location enrichment")
    try expect(requests[0].url?.absoluteString == "https://us.i.posthog.com/batch/" && requests[0].timeoutInterval == 5, "Analytics transport isn't bounded")
    try expect((try files.attributesOfItem(atPath: analytics.file.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Analytics identity file isn't private")
    analytics.capture("unknown_event", properties: [:])
    for _ in 0..<220 { analytics.capture("installer_stage_reached", properties: ["stage": "preflight"]) }
    try expect(analytics.snapshot().events.count == 200 && requests.count == 1, "Offline queue or concurrent sends are unbounded")
    try expect(analytics.setEnabled(false), "Opt-out failed")
    try expect(cancellations == 1 && !analytics.enabled && analytics.snapshot().identity == nil && analytics.snapshot().events.isEmpty, "Opt-out retained identity or queued events")
    callbacks[0](200, Data("{\"status\":1}".utf8))
    try expect(analytics.snapshot().events.isEmpty, "Old completion resurrected opted-out events")
    try expect(analytics.setEnabled(true), "Opt-in after opt-out failed")
    analytics.opened(properties: [:])
    try expect(analytics.snapshot().identity != initial.identity, "Re-enabling reused the cleared identity")
    callbacks.last!(200, Data("{\"status\":1,\"quota_limited\":[\"events\"]}".utf8))
    try expect(analytics.snapshot().events.count == 1, "Quota rejection discarded an event")
    _ = analytics.setEnabled(false)

    let app = root.appendingPathComponent("bridge-app")
    let target = app.appendingPathComponent("productAnalyticsBridge.js")
    try put(target, "disabled placeholder")
    try put(app.appendingPathComponent("manifest.json"), "{\"subfiles_extension\":[\"productAnalyticsBridge.js\"]}")
    try expect(analytics.writeHistoricalHandoff(to: app) && text(target).contains("\"enabled\":false"), "Opt-out before apply left an enabled handoff")
    _ = analytics.setEnabled(true)
    let linkedIdentity = analytics.snapshot().identity!.uuidString
    try expect(analytics.writeHistoricalHandoff(to: app) && text(target).contains(linkedIdentity) && text(target).contains("expiresAt"), "Enabled handoff lost identity or expiry")
    if let directory = ProcessInfo.processInfo.environment["TAGIFY_INSTALLER_QA_DIR"] {
        try put(URL(fileURLWithPath: directory).appendingPathComponent("historical-bridge.js"), text(target))
    }
    try expect(!text(target).contains("phc_") && !text(target).contains("token"), "Handoff copied project credentials unnecessarily")
    _ = analytics.setEnabled(false)
    try expect(analytics.writeHistoricalHandoff(to: app) && !text(target).contains(linkedIdentity), "Disabled handoff retained prior setup identity")
    _ = analytics.setEnabled(true)
    try expect(analytics.writeHistoricalHandoff(to: app) && !text(target).contains(linkedIdentity), "Re-opt-in handoff reused a cleared manager identity")
    try put(app.appendingPathComponent("manifest.json"), "corrupt")
    let before = text(target)
    try expect(!analytics.writeHistoricalHandoff(to: app) && text(target) == before, "Corrupt manifest changed a shipped extension")
    try put(app.appendingPathComponent("manifest.json"), "{\"subfiles_extension\":[\"productAnalyticsBridge.js\"]}")
    try files.removeItem(at: target)
    try files.createSymbolicLink(at: target, withDestinationURL: root.appendingPathComponent("private-file"))
    try expect(!analytics.writeHistoricalHandoff(to: app), "Bridge followed a symbolic link")
    try expect(!analytics.writeHistoricalHandoff(to: root.appendingPathComponent("absent")), "Absent bridge did not fail safely")
    _ = analytics.setEnabled(false)
    let setup = try Fixture(fresh: true)
    var attempted = false
    setup.installer.prepareAnalyticsHandoff = { _ in attempted = true; _ = analytics.writeHistoricalHandoff(to: app) }
    _ = try setup.installer.install(architecture: "arm64")
    try expect(attempted && setup.spiceCommands.contains(["--no-restart", "backup", "apply"]), "Optional bridge failure interrupted actual installation")

    let relaunched = InstallerAnalytics(home: root.appendingPathComponent("relaunch"), configuration: config, transport: transport)
    _ = relaunched.setEnabled(true); relaunched.opened(properties: [:])
    let saved = relaunched.snapshot()
    callbacks.last!(200, Data("{\"status\":1}".utf8))
    try expect(relaunched.snapshot().events.isEmpty, "Acknowledged event wasn't removed")
    let again = InstallerAnalytics(home: root.appendingPathComponent("relaunch"), configuration: config, transport: transport)
    again.opened(properties: [:])
    try expect(again.snapshot().identity == saved.identity && again.snapshot().events.first?.properties["first_observed_open"] == "false", "Relaunch lost consent or identity")
    _ = again.setEnabled(false)
    let optedOut = InstallerAnalytics(home: root.appendingPathComponent("relaunch"), configuration: config, transport: transport)
    optedOut.opened(properties: [:])
    try expect(!optedOut.enabled && optedOut.snapshot().events.isEmpty, "Restart enabled a saved opt-out")
    relaunched.capture("installer_help_opened", properties: ["help": "spicetify"])
    try expect(relaunched.snapshot().events.isEmpty, "Another instance ignored saved opt-out")

    for (index, sample) in [(200, "{\"status\":1}", true), (200, "{\"status\":\"Ok\"}", true),
                             (200, "{\"status\":\"Ok\",\"quota_limited\":[\"events\"]}", false),
                             (200, "{}", false), (200, "null", false), (200, "{\"status\":\"Error\"}", false),
                             (429, "{\"status\":\"Ok\"}", false)].enumerated() {
        let check = InstallerAnalytics(home: root.appendingPathComponent("ack-\(index)"), configuration: config, transport: transport)
        _ = check.setEnabled(true); check.opened(properties: [:]); _ = check.snapshot()
        callbacks.last!(sample.0, Data(sample.1.utf8))
        try expect(check.snapshot().events.isEmpty == sample.2, "Unexpected batch acknowledgement handling for case \(index)")
        _ = check.setEnabled(false)
    }

    let stale = InstallerAnalytics(home: root.appendingPathComponent("stale"), configuration: config, now: { Date(timeIntervalSince1970: 100) }, transport: transport)
    _ = stale.setEnabled(true); stale.opened(properties: [:]); _ = stale.snapshot()
    let fresh = InstallerAnalytics(home: root.appendingPathComponent("stale"), configuration: config, now: { Date(timeIntervalSince1970: 100 + 8 * 86400) }, transport: transport)
    fresh.opened(properties: [:])
    try expect(fresh.snapshot().events.count == 1, "Expired offline events survived retention")
    _ = stale.setEnabled(false); _ = fresh.setEnabled(false)

    let unavailable = InstallerAnalytics(home: root.appendingPathComponent("unconfigured"), configuration: nil, transport: transport)
    try expect(!unavailable.setEnabled(true) && !unavailable.enabled, "Unconfigured build accepted consent")
    try expect(!files.fileExists(atPath: unavailable.file.path), "Unconfigured analytics wrote a state file")
    for host in ["http://us.i.posthog.com", "https://us.i.posthog.com.evil.test", "https://user@us.i.posthog.com", "https://us.i.posthog.com/path"] {
        try expect(InstallerAnalyticsConfiguration(token: "phc_test", host: host).endpoint == nil, "Untrusted analytics origin accepted")
    }
    try expect(InstallerAnalyticsConfiguration(token: "personal-secret", host: config.host).endpoint == nil, "Personal key accepted in client configuration")

    let broken = InstallerAnalytics(home: root.appendingPathComponent("broken"), configuration: config, transport: transport)
    try put(broken.file, "not JSON")
    try expect(!broken.enabled, "Corrupt consent failed open")
    try files.removeItem(at: broken.file)
    try files.createDirectory(at: broken.file, withIntermediateDirectories: false)
    try expect(!broken.setEnabled(true) && !broken.enabled, "Consent storage failure was reported as saved")
    try files.removeItem(at: broken.file)
    let lock = Darwin.open(broken.file.appendingPathExtension("lock").path, O_CREAT | O_RDWR, 0o600)
    defer { Darwin.close(lock) }
    flock(lock, LOCK_EX)
    try expect(!broken.setEnabled(true), "A busy consent lock was ignored")
    flock(lock, LOCK_UN)
    try expect(InstallerAnalyticsFailure.reason(NSError(domain: NSPOSIXErrorDomain, code: Int(ENOSPC))) == "disk_space", "Disk failure classification lost")
    try expect(InstallerAnalyticsFailure.reason(NSError(domain: NSURLErrorDomain, code: -1009)) == "network", "Network failure classification lost")
}
