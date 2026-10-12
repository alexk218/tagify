import AppKit
import Sparkle

protocol ManagerUpdating: AnyObject {
    func check() throws
}

// Sparkle owns archive verification, authorization, replacement and relaunch.
// GitHub discovery only supplies the existing reminder; it never installs code.
final class ManagerUpdater: NSObject, ManagerUpdating, SPUUpdaterDelegate {
    var downloadStarted: () -> Void = {}
    var downloadFinished: (Error?) -> Void = { _ in }
    var finished: () -> Void = {}
    var willRelaunch: () -> Void = {}
    var skipped: (String) -> Void = { _ in }
    private var downloading = false
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    private var started = false

    func check() throws {
        if !started { try controller.updater.start(); started = true }
        controller.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, userDidMake choice: SPUUserUpdateChoice, forUpdate item: SUAppcastItem, state: SPUUserUpdateState) {
        if choice == .skip { skipped(item.displayVersionString) }
        if choice == .install && state.stage == .notDownloaded && !downloading {
            downloading = true; downloadStarted()
        }
    }
    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        if downloading { downloading = false; downloadFinished(nil) }
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        if downloading {
            downloading = false
            downloadFinished(error ?? NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
        finished()
    }
    func updaterWillRelaunchApplication(_ updater: SPUUpdater) { willRelaunch() }
}
