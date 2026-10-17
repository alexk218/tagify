#if INSTALLER_UI_TESTS
import AppKit

extension InstallerApp {
    func runUITests(output: URL) throws {
        let files = FileManager.default
        try files.createDirectory(at: output, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: home) }
        var assertions = 0
        func expect(_ value: Bool, _ message: String) throws {
            assertions += 1
            guard value else { throw InstallerFailure(message: message) }
        }
        func settle() {
            window.contentView?.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: Date().addingTimeInterval(0.06))
        }
        func capture(_ name: String, window target: NSWindow? = nil) throws {
            settle()
            let view = (target ?? window).contentView!
            view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
            guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw InstallerFailure(message: "Couldn't render \(name)") }
            view.effectiveAppearance.performAsCurrentDrawingAppearance { view.cacheDisplay(in: view.bounds, to: bitmap) }
            // The view capture excludes the window's background; composite it as AppKit does on screen.
            let rendered = NSImage(size: view.bounds.size)
            view.effectiveAppearance.performAsCurrentDrawingAppearance {
                rendered.lockFocus()
                (target ?? window).backgroundColor.setFill()
                NSBezierPath(rect: NSRect(origin: .zero, size: view.bounds.size)).fill()
                bitmap.draw(in: NSRect(origin: .zero, size: view.bounds.size))
                rendered.unlockFocus()
            }
            guard let tiff = rendered.tiffRepresentation, let final = NSBitmapImageRep(data: tiff), let data = final.representation(using: .png, properties: [:]) else { throw InstallerFailure(message: "Couldn't save \(name)") }
            try data.write(to: output.appendingPathComponent(name + ".png"))
        }

        preview("ready")
        let analyticsHome = home.appendingPathComponent("analytics-fixture")
        analytics = InstallerAnalytics(home: analyticsHome, configuration: InstallerAnalyticsConfiguration(token: "phc_test", host: "https://us.i.posthog.com"), transport: { _, _ in {} })
        func buttonTitles(_ view: NSView) -> [String] {
            (view as? NSButton).map { [$0.title] } ?? [] + view.subviews.flatMap(buttonTitles)
        }
        try expect(!buttonTitles(window.contentView!).contains(where: { $0 == "What's shared?" || $0 == "Share setup and usage statistics" }), "Analytics controls remain in the setup window")
        analytics?.opened(properties: analyticsContext())
        try expect(analytics?.enabled == true && analytics?.snapshot().events.count == 1, "Automatic analytics did not record the open")
        beginTracking("repair"); trackStage("preflight"); trackStage("preflight")
        finishTracking(error: InstallerFailure(message: "/Users/private failure", reason: "verification"))
        let analyticsEvents = analytics!.snapshot().events
        try expect(analyticsEvents.map(\.event) == ["installer_opened", "installer_operation_started", "installer_stage_reached", "installer_operation_finished"], "Operation tracking duplicated stages or omitted results")
        try expect(analyticsEvents.last?.properties["outcome"] == "failure" && analyticsEvents.last?.properties["failure_reason"] == "verification", "Operation result wasn't classified")
        try capture("installer-automatic-analytics")
        beginTracking("repair")
        try expect(analytics!.setEnabled(false), "Could not save existing opt-out fixture")
        finishTracking(error: nil)
        try expect(analytics?.enabled == false && analytics?.snapshot().events.isEmpty == true && analyticsOperation == nil, "Opt-out left a running operation tracked")
        analytics = InstallerAnalytics(home: analyticsHome, configuration: InstallerAnalyticsConfiguration(token: "phc_test", host: "https://us.i.posthog.com"), transport: { _, _ in {} })
        analytics?.opened(properties: analyticsContext())
        try expect(analytics?.enabled == false && analytics?.snapshot().events.isEmpty == true, "Saved opt-out was not preserved after relaunch")
        analytics = nil
        var opens = 0
        openSpotifyOverride = { opens += 1 }
        action.performClick(nil)
        try expect(opens == 1 && installer == nil && !busy, "Healthy setup didn't open Spotify without reinstalling")
        try expect(action.title == "Open Spotify" && !repair.isHidden && repair.isEnabled, "Healthy setup lacks open and repair actions")
        try expect(blockUpdates.state == .on && !apply.isEnabled, "Applied update setting should have no pending changes")
        try expect(componentIcons.count == 3 && componentIcons.allSatisfy { $0.image != nil }, "Product logos did not load for the setup cards")
        try expect(spotifyRequirement.stringValue.contains("desktop app") && spotifyRequirement.stringValue.contains("spotify.com"), "The main setup screen omitted Spotify's required desktop download")
        try expect(window.title == "Tagify Manager" && discordHelp.title == "Get help on Discord" && discordHelp.isEnabled && Self.discordHelpURL.absoluteString == "https://discord.gg/C4qbPUbBKV", "Manager branding or Discord help is missing")
        try expect(refresh.title == "Check again" && logs.title == "Logs" && logs.isEnabled, "Windows-style setup controls are missing")
        logs.performClick(nil); settle()
        try expect(detailsPanel?.isVisible == true && detailsPanel?.title == "Installer logs" && detailsText.string.contains("No setup activity yet") && !copyButton.isEnabled, "Logs cannot open before installation")
        try capture("installer-empty-logs", window: detailsPanel)
        detailsPanel?.orderOut(nil)
        refresh.performClick(nil)
        try expect(!busy && installer == nil && action.title == "Open Spotify", "Check again changed a healthy setup")
        try expect(pendingStatus.isHidden && pendingStatus.stringValue.isEmpty && !intro.isSelectable, "Ready installer shows redundant setting feedback or selectable labels")
        try capture("installer-ready")
        blockUpdates.performClick(nil)
        try expect(blockUpdates.state == .off && apply.isEnabled && pendingStatus.stringValue.contains("Unsaved"), "Checkbox change wasn't shown as pending")
        try expect(setup.updatesBlocked == true && preferences.blockSpotifyUpdates == true, "Pending selection overwrote applied or saved setting")
        try capture("installer-pending-setting")

        tutorialButton.performClick(nil)
        try expect(tutorial?.page == 0 && window.attachedSheet != nil, "Tutorial couldn't be reopened")
        try expect(tutorial!.body.attributedStringValue.attribute(.link, at: 0, effectiveRange: nil) as? URL == URL(string: "https://spicetify.app/"), "Tutorial Spicetify name isn't linked to its homepage")
        settle()
        let homepageRegion = tutorial!.body.linkRegions().first!
        try expect(tutorial!.body.link(at: NSPoint(x: homepageRegion.0.midX, y: homepageRegion.0.midY)) == URL(string: "https://spicetify.app/") && !tutorial!.body.isSelectable, "Non-selectable tutorial lost its clickable homepage")
        try capture("tutorial-first-page", window: tutorial!.panel)
        tutorial!.next.performClick(nil)
        try expect(tutorial?.page == 1 && !preferences.tutorialCompleted, "Tutorial advanced or completed incorrectly")
        try expect(tutorial!.body.stringValue.contains("spotify.com/download/mac") && tutorial!.body.stringValue.contains("web player"), "Tutorial omitted the Mac desktop download requirement")
        let downloadRange = (tutorial!.body.stringValue as NSString).range(of: "spotify.com/download/mac")
        try expect(!tutorial!.body.isSelectable && tutorial!.body.allowsEditingTextAttributes &&
                   tutorial!.body.attributedStringValue.attribute(.link, at: downloadRange.location, effectiveRange: nil) as? URL == URL(string: "https://www.spotify.com/download/mac/"),
                   "Tutorial Spotify download text isn't an interactive official hyperlink")
        settle()
        let spotifyRegion = tutorial!.body.linkRegions().first!
        try expect(tutorial!.body.link(at: NSPoint(x: spotifyRegion.0.midX, y: spotifyRegion.0.midY)) == URL(string: "https://www.spotify.com/download/mac/"), "Non-selectable tutorial lost its clickable Spotify download")
        try capture("tutorial-spotify-requirement", window: tutorial!.panel)
        tutorial!.close.performClick(nil); settle()
        try expect(tutorial == nil && !preferences.tutorialCompleted, "Closing tutorial incorrectly marked it complete")
        tutorialButton.performClick(nil)
        try expect(tutorial?.page == 0, "Tutorial didn't restart from its first page")
        tutorial!.next.performClick(nil); tutorial!.next.performClick(nil)
        try expect(tutorial?.next.title == "Got it" && !preferences.tutorialCompleted, "Tutorial completed before the final action")
        try expect(tutorial!.heading.stringValue == "Keep this app somewhere safe" && tutorial!.body.stringValue.contains("Repair Tagify"), "Final tutorial omits keeping the manager for repairs")
        try capture("tutorial-repair-guidance", window: tutorial!.panel)
        tutorial!.next.performClick(nil); settle()
        try expect(preferences.tutorialCompleted && tutorial == nil, "Tutorial completion wasn't remembered")
        try preferences.save(home: home)
        let saved = try InstallerPreferences.load(home: home)
        try expect(saved.tutorialCompleted && saved.blockSpotifyUpdates == true, "Completion did not persist independently of the update setting")
        tutorialButton.performClick(nil)
        try expect(tutorial?.page == 0 && preferences.tutorialCompleted, "Completed tutorial couldn't be replayed")
        try expect(blockUpdates.state == .off && apply.isEnabled && setup.updatesBlocked == true, "Replaying tutorial changed pending or applied protection")
        try capture("tutorial-reopened", window: tutorial!.panel)
        tutorial!.close.performClick(nil); settle()
        try expect(preferences.tutorialCompleted, "Closing a replay reset tutorial completion")

        preview("missing")
        action.performClick(nil)
        try expect(guide != nil && window.isVisible, "Missing Spotify did not open guidance over the main window")
        settle()
        let setupLink = guideText!.linkRegions().first!
        try expect(!guideText!.isSelectable && guideText!.link(at: NSPoint(x: setupLink.0.midX, y: setupLink.0.midY)) == URL(string: "https://www.spotify.com/download/mac/"), "Spotify setup download is not clickable without selecting text")
        try capture("spotify-setup", window: guide)
        dismissGuide(); settle()
        try expect(guide == nil && window.isVisible && action.title == "Set up Spotify", "Back from setup closed the main window")
        action.performClick(nil); settle()
        try expect(guide != nil, "Spotify guide couldn't be reopened")
        dismissGuide(); settle()

        preview("progress")
        try expect(busy && !action.isEnabled && !blockUpdates.isEnabled && !tutorialButton.isEnabled, "Install controls weren't locked")
        try expect(!windowShouldClose(window) && window.styleMask.contains(.miniaturizable), "Work couldn't be minimized or could be closed")
        try expect(stageIndicators[0].stringValue == "✓" && stageIndicators[1].stringValue == "✓" && stageIndicators[2].stringValue == "●" && stageIndicators[3].stringValue == "○", "Progress marked future steps complete")
        try expect(setupCards.isHidden && sourceGuidanceCard.isHidden && updateProtectionCard.isHidden, "Setup cards crowd the active installation progress")
        try capture("installer-progress")

        preview("failure")
        var retries = 0
        showFailure("Spotify is still open. Quit Spotify completely, then try again.", retry: { retries += 1 })
        retry.performClick(nil)
        try expect(retries == 1 && !errorCard.isHidden && !busy, "Inline failure couldn't retry the failed action")
        try capture("installer-recovery")
        showFailure(TagifyInstaller.spotifyReinstallMessage, retry: {})
        try capture("installer-spotify-reinstall")
        appendDiagnostic("Tagify Installer 1.0.1 | Test diagnostics\nDownload couldn't be verified.")
        logs.performClick(nil)
        try expect(copyButton.isEnabled && detailsText.string.contains("Download couldn't be verified."), "Failure details omitted diagnostics")
        try capture("installer-details", window: detailsPanel)
        detailsPanel?.orderOut(nil)

        preview("repair")
        try expect(action.title == "Repair Tagify", "Missing applied Tagify did not offer repair")
        try capture("installer-repair")
        preview("tagify-update")
        try expect(action.title == "Update Tagify", "Newer Tagify release did not offer update")
        try capture("tagify-update")
        preview("spicetify-update")
        try expect(action.title == "Update setup" && componentStates[1].stringValue.contains("Update available"), "Newer Spicetify was hidden behind Open Spotify")
        try capture("spicetify-update")
        setup.tagifyVersion = nil; setup.tagifyApplied = false; render()
        try expect(action.title == "Install Tagify", "A CLI update hid first-time Tagify installation")
        preview("repair"); latestSpicetify = "2.45.4"; render()
        try expect(action.title == "Update setup" && repair.title == "Repair without updating" && !repair.isHidden, "A broken setup cannot choose a Spicetify update or repair without updating")
        final class UpdateProbe: ManagerUpdating {
            var checks = 0
            var failure: Error?
            func check() throws { checks += 1; if let failure = failure { throw failure } }
        }
        let updater = UpdateProbe(); managerUpdater = updater
        preview("update"); settle()
        try expect(updater.checks == 1 && busy && !action.isEnabled, "Update didn't hand off to Sparkle or lock setup during the update")
        try capture("installer-update-handoff")
        managerUpdateFinished(); settle() // Sparkle's Later/Cancel completion callback.
        try expect(!busy && !updateCard.isHidden && window.isVisible, "Deferring an update removed the reminder or closed setup")
        updateButton.performClick(nil); settle()
        try expect(updater.checks == 2 && busy, "Deferred update couldn't be reopened")
        managerUpdateFinished()
        skipManagerVersion("1.0.2"); didPromptUpdate = false
        try expect(try InstallerPreferences.load(home: home).skippedManagerVersion == "1.0.2", "Skipped manager version wasn't saved")
        offerUpdateIfNeeded(); settle()
        try expect(updater.checks == 2 && !busy, "Skipped manager version prompted again automatically")
        updater.failure = InstallerFailure(message: "Fixture updater initialization failed")
        updateButton.performClick(nil); settle()
        try expect(!busy && !errorCard.isHidden && action.isEnabled, "Updater failure blocked normal setup")
        try capture("installer-update-error")
        configureManagerUpdater()
        let realUpdater = managerUpdater as! ManagerUpdater
        busy = true; realUpdater.finished()
        try expect(!busy && action.isEnabled, "Sparkle completion didn't unlock the manager")
        busy = true; realUpdater.willRelaunch()
        try expect(applicationShouldTerminate(NSApp) == .terminateNow, "Manager blocked Sparkle from closing the old process")
        managerUpdater = nil

        preview("small"); settle()
        let buttonFrame = action.convert(action.bounds, to: window.contentView)
        try expect(window.contentView!.bounds.contains(buttonFrame), "Primary action is clipped on a small window")
        try expect(scroll.hasVerticalScroller && (scroll.documentView?.frame.height ?? 0) > scroll.contentView.bounds.height, "Small window doesn't scroll")
        try capture("installer-small-screen")
        // Exercise the real window actions and production engine on an isolated Spotify fixture.
        preview("ready")
        window.setContentSize(NSSize(width: 640, height: 740))
        let fixture = try Fixture(fresh: true)
        spotify = fixture.paths.spotify
        setup = SetupStatus.inspect(paths: fixture.paths)
        isPreview = false
        installerFactoryOverride = { _ in fixture.installer }
        analytics = InstallerAnalytics(home: analyticsHome, configuration: InstallerAnalyticsConfiguration(token: "phc_test", host: "https://us.i.posthog.com"), transport: { _, _ in {} })
        try expect(analytics!.setEnabled(true), "Fixture analytics consent failed")
        render()
        func waitForOperation() throws {
            let deadline = Date().addingTimeInterval(20)
            while busy && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
            try expect(!busy, "Native install action timed out")
            settle()
        }
        action.performClick(nil)
        try expect(busy, "Install button didn't start the production operation")
        try waitForOperation()
        try expect(setup.ready && action.title == "Open Spotify" && repair.isEnabled && errorCard.isHidden, "Native install didn't finish in a verified ready state")
        try expect(preferences.blockSpotifyUpdates == true && fixture.closed, "Native install didn't save its verified setting or close the isolated Spotify copy")
        try capture("installer-installed")
        let before = fixture.spiceCommands.count
        action.performClick(nil)
        try expect(opens == 2 && fixture.spiceCommands.count == before, "Open after installation reran setup")
        blockUpdates.performClick(nil); apply.performClick(nil)
        try waitForOperation()
        try expect(fixture.spiceCommands.count == before && setup.updatesBlocked == false && preferences.blockSpotifyUpdates == false && !apply.isEnabled, "Apply Changes didn't save protection independently without Spicetify")
        fixture.failUpdateSetting = true
        blockUpdates.performClick(nil); apply.performClick(nil)
        try waitForOperation()
        try expect(!errorCard.isHidden && setup.updatesBlocked == false && preferences.blockSpotifyUpdates == false && apply.isEnabled, "Failed setting change lost rollback or the pending choice")
        try capture("installer-setting-recovery")
        fixture.failUpdateSetting = false; retry.performClick(nil)
        try waitForOperation()
        try expect(errorCard.isHidden && setup.updatesBlocked == true && preferences.blockSpotifyUpdates == true && !apply.isEnabled, "Retry didn't save and verify the restored setting")
        // Recover through the actual primary action, using a saved disk record.
        let recoveryBackup = fixture.paths.backups.appendingPathComponent("interrupted-ui")
        let recoveryState = try SpotifyUpdateState(directory: fixture.paths.spotifyUpdates, backup: recoveryBackup)
        _ = try InstallSnapshot(directory: recoveryBackup, paths: fixture.paths.protectedPaths)
        var recoveryRecord = InstallJournal(spotify: fixture.paths.spotify, updateState: recoveryState)
        recoveryRecord.hasSnapshot = true
        try recoveryRecord.save(in: recoveryBackup)
        let previousExtension = text(fixture.paths.tagify.appendingPathComponent("extension.js"))
        try put(fixture.paths.tagify.appendingPathComponent("extension.js"), "interrupted replacement")
        recoveryNeeded = true; render()
        try expect(action.title == "Restore previous setup" && repair.isHidden && !apply.isEnabled, "Interrupted setup didn't take priority over installation and settings")
        try capture("installer-interrupted")
        action.performClick(nil)
        try waitForOperation()
        try expect(!recoveryNeeded && setup.ready && errorCard.isHidden && text(fixture.paths.tagify.appendingPathComponent("extension.js")) == previousExtension, "Restore action didn't recover the previous setup")
        try capture("installer-restored")
        setup.tagifyVersion = "3.2.0-beta.1"; latestTagify = "4.0.0"; render()
        try expect(action.title == "Open Spotify", "Healthy beta was offered a stable channel switch")
        setup.tagifyApplied = false; render()
        try expect(action.title == "Repair Tagify" && intro.stringValue.contains("3.2.0-beta.1"), "Beta repair omitted its retained version")
        try capture("installer-beta-repair")
        setup = SetupStatus.inspect(paths: fixture.paths); latestTagify = nil; latestSpicetify = "2.45.4"
        setup.spicetifySource = .homebrew; render()
        try expect(action.title == "Open Spotify" && !spiceHelp.isHidden && spiceHelp.isEnabled && componentStates[1].stringValue.contains("Homebrew") && repair.title == "Repair without updating", "Healthy Homebrew setup blocked opening Spotify or hid update help")
        try capture("installer-homebrew")
        let beforeHelp = fixture.spiceCommands.count
        var openedHomebrewSpotify = false
        openSpotifyOverride = { openedHomebrewSpotify = true }
        action.performClick(nil); settle()
        try expect(openedHomebrewSpotify && !busy && window.attachedSheet == nil && fixture.spiceCommands.count == beforeHelp, "Healthy Homebrew setup attempted an update instead of opening Spotify")
        spiceHelp.performClick(nil); settle()
        try expect(window.attachedSheet != nil && fixture.spiceCommands.count == beforeHelp, "Homebrew help changed the installation")
        try capture("installer-homebrew-help", window: window.attachedSheet)
        if let sheet = window.attachedSheet { window.endSheet(sheet, returnCode: .alertFirstButtonReturn); sheet.orderOut(nil) }
        setup.spicetifyComplete = false; render()
        try expect(action.title == "Spicetify repair help" && componentStates[1].stringValue.contains("Needs attention") && repair.isHidden, "Broken Homebrew installation lacks targeted repair guidance")
        action.performClick(nil); settle()
        try capture("installer-homebrew-repair-help", window: window.attachedSheet)
        if let sheet = window.attachedSheet { window.endSheet(sheet, returnCode: .alertFirstButtonReturn); sheet.orderOut(nil) }
        isPreview = true
        selectSpotify(fixture.paths.spotify)
        try expect(try InstallerPreferences.load(home: home).spotifyPath == fixture.paths.spotify.path, "Chosen Spotify location wasn't remembered")
        setup.spotifyReadOnly = true; render()
        try expect(action.title == "Choose Spotify…" && intro.stringValue.contains("read-only") && repair.isHidden, "Read-only Spotify wasn't explained or offered an unusable repair")
        try capture("installer-read-only-spotify")
        setup.spotifyReadOnly = false; setup.spotifyPrepared = false; render()
        try expect(componentStates[0].stringValue == "Open Spotify first", "Installer claimed a sign-in state it cannot verify")
        isPreview = false; latestSpicetify = nil
        setup = SetupStatus.inspect(paths: fixture.paths); render()
        fixture.closed = false
        fixture.installer.diskVolume = { _ in InstallerVolume(id: "disk", name: "Macintosh HD", available: 1024) }
        repair.performClick(nil); try waitForOperation()
        try expect(!errorCard.isHidden && errorMessage.stringValue.contains("Not enough free space") && !fixture.closed, "Low-space repair closed Spotify or lacked actionable feedback")
        window.setContentSize(NSSize(width: 560, height: 458))
        try capture("installer-low-space-small")
        fixture.installer.diskVolume = InstallerDiskSpace.volume
        try files.removeItem(at: fixture.paths.binary)
        try files.removeItem(at: fixture.paths.prefs)
        try files.removeItem(at: fixture.paths.spotify)
        chflags(fixture.paths.spotifyUpdates.path, 0)
        try put(fixture.paths.spotifyUpdates.appendingPathComponent("cached-update"), "keep")
        chflags(fixture.paths.spotifyUpdates.path, UInt32(UF_IMMUTABLE))
        spotify = nil; setup = SetupStatus.inspect(paths: fixture.paths); errorCard.isHidden = true
        blockUpdates.state = .on; render(); blockUpdates.performClick(nil)
        try expect(apply.isEnabled && pendingStatus.stringValue.contains("allow") && protectionStatus.stringValue.contains("attention"), "Missing Spotify/CLI trapped users with a partly locked update folder")
        window.setContentSize(NSSize(width: 640, height: 740))
        try capture("installer-unblock-broken")
        apply.performClick(nil); try waitForOperation()
        try expect(errorCard.isHidden && setup.updateFolderLocked == false && preferences.blockSpotifyUpdates == false && !apply.isEnabled, "Native UI could not enable updates without Spotify or Spicetify")
        try capture("installer-unblocked-broken")
        let recorded = analytics!.snapshot().events
        let starts = recorded.filter { $0.event == "installer_operation_started" }
        let finishes = recorded.filter { $0.event == "installer_operation_finished" }
        try expect(starts.count == 7 && finishes.count == 7, "Native flows lost an analytics start or finish")
        try expect(Set(starts.compactMap { $0.properties["operation_id"] }).count == 7, "Retries reused an operation identity")
        try expect(finishes.compactMap { $0.properties["operation"] } == ["install", "allow_updates", "block_updates", "block_updates", "recover", "repair", "allow_updates"], "Native flows reported incorrect operations")
        try expect(finishes.compactMap { $0.properties["outcome"] } == ["success", "success", "failure", "success", "success", "failure", "success"], "Native flows reported incorrect outcomes")
        try expect(finishes[5].properties["failure_reason"] == "disk_space", "Low-space UI failure lost its analytics reason")
        for finish in finishes {
            try expect(starts.contains { $0.properties["operation_id"] == finish.properties["operation_id"] }, "Finish wasn't linked to its start")
        }
        _ = analytics?.setEnabled(false); analytics = nil
        installerFactoryOverride = nil
        isPreview = true
        print("Passed \(assertions) native Mac UI assertions: readiness, open without reinstall, pending settings, tutorial dismissal/completion/replay, setup help, progress, recovery, update reminders, small windows, and real window-to-engine installation/setting/retry flows.")
    }
}

#endif
