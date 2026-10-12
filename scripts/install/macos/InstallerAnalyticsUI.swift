import AppKit

extension InstallerApp {
    func analyticsContext() -> [String: String] {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return ["installer_version": Self.version, "os_version": "\(os.majorVersion).\(os.minorVersion)",
                "architecture": Self.architecture, "spotify_version": setup.spotifyVersion ?? "unknown",
                "spicetify_version": setup.spicetifyVersion ?? "unknown", "tagify_version": setup.tagifyVersion ?? "unknown",
                "spicetify_source": setup.spicetifySource.rawValue, "setup_present": setup.tagifyVersion == nil ? "false" : "true"]
    }
    func beginTracking(_ kind: String) {
        analyticsStages = []
        guard analytics?.enabled == true else { analyticsOperation = nil; return }
        analyticsOperation = (UUID().uuidString, kind, Date())
        track("installer_operation_started")
    }
    func trackStage(_ stage: String) {
        guard analyticsOperation != nil, analyticsStages.insert(stage).inserted else { return }
        track("installer_stage_reached", extra: ["stage": stage])
    }
    func finishTracking(error: Error?) {
        guard let operation = analyticsOperation else { return }
        let reason = error.map(InstallerAnalyticsFailure.reason) ?? "none"
        track("installer_operation_finished", extra: ["outcome": error == nil ? "success" : reason == "cancelled" ? "cancelled" : "failure",
            "failure_reason": reason, "duration_seconds": String(max(0, Int(Date().timeIntervalSince(operation.started)))),
            "recovery_needed": recoveryNeeded ? "true" : "false"])
        analyticsOperation = nil
    }
    private func track(_ event: String, extra: [String: String] = [:]) {
        guard let operation = analyticsOperation else { return }
        var props = analyticsContext()
        props["operation_id"] = operation.id; props["operation"] = operation.kind
        analytics?.capture(event, properties: props.merging(extra, uniquingKeysWith: { _, new in new }))
    }
}
