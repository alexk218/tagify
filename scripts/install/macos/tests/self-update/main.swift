import AppKit

// Real Sparkle UI/installer running in disposable app bundles, never the user's Manager.
final class FixtureApp: NSObject, NSApplicationDelegate {
    let updater = ManagerUpdater()
    let info = Bundle.main.infoDictionary!
    var captured = false
    var timer: Timer?
    func log(_ event: String) {
        let url = URL(fileURLWithPath: info["FixtureLog"] as! String)
        let line = "\(event) \(ProcessInfo.processInfo.processIdentifier)\n".data(using: .utf8)!
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        let handle = try! FileHandle(forWritingTo: url); handle.seekToEndOfFile(); handle.write(line); try! handle.close()
    }
    func buttons(_ view: NSView) -> [NSButton] { (view as? NSButton).map { [$0] } ?? view.subviews.flatMap(buttons) }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        if info["CFBundleVersion"] as? String == "2" {
            log("relaunched-new"); NSApp.terminate(nil); return
        }
        log("launched-old")
        updater.downloadStarted = { self.log("download-started") }
        updater.downloadFinished = { self.log($0 == nil ? "downloaded" : "download-failed") }
        updater.willRelaunch = { self.log("will-relaunch") }
        updater.finished = { self.log("finished") }
        do { try updater.check() } catch { log("start-failed"); NSApp.terminate(nil) }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            for window in NSApp.windows where window.isVisible {
                guard let content = window.contentView else { continue }
                let controls = self.buttons(content).filter { $0.isEnabled && !$0.isHidden }
                if controls.contains(where: { $0.title == "Install Update" }) {
                    if !self.captured {
                        self.captured = true
                        self.log("buttons:" + controls.map { $0.title }.joined(separator: "|"))
                        content.layoutSubtreeIfNeeded(); content.displayIfNeeded()
                        if let image = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
                            content.effectiveAppearance.performAsCurrentDrawingAppearance { content.cacheDisplay(in: content.bounds, to: image) }
                            let rendered = NSImage(size: content.bounds.size)
                            content.effectiveAppearance.performAsCurrentDrawingAppearance {
                                rendered.lockFocus(); window.backgroundColor.setFill()
                                NSBezierPath(rect: NSRect(origin: .zero, size: content.bounds.size)).fill()
                                image.draw(in: NSRect(origin: .zero, size: content.bounds.size)); rendered.unlockFocus()
                            }
                            if let tiff = rendered.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) {
                                try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: (self.info["FixtureLog"] as! String) + ".png"))
                            }
                        }
                    }
                    if self.info["FixtureScenario"] as? String == "cancel" {
                        if let cancel = controls.first(where: { $0.title.contains("Later") || $0.title.contains("Cancel") || $0.title.contains("Skip") }) {
                            self.log("cancelled"); cancel.performClick(nil); DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
                        }
                        return
                    }
                }
                if self.info["FixtureManual"] as? Bool == true { return }
                for button in controls {
                    if ["Install Update", "Install and Relaunch"].contains(button.title) {
                        self.log("click-" + button.title.replacingOccurrences(of: " ", with: "-")); button.performClick(nil); return
                    }
                    if ["OK", "Cancel Update"].contains(button.title) {
                        self.log("alert"); button.performClick(nil); DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }; return
                    }
                }
            }
        }
        RunLoop.main.add(timer!, forMode: .modalPanel)
        let timeout = Timer(timeInterval: self.info["FixtureManual"] as? Bool == true ? 180 : 40, repeats: false) { _ in self.log("timeout"); NSApp.terminate(nil) }
        RunLoop.main.add(timeout, forMode: .common)
        RunLoop.main.add(timeout, forMode: .modalPanel)
    }
}
let app = NSApplication.shared
let delegate = FixtureApp()
app.delegate = delegate
app.run()
