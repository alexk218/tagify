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
        var opens = 0
        openSpotifyOverride = { opens += 1 }
        action.performClick(nil)
        try expect(opens == 1 && installer == nil && !busy, "Healthy setup didn't open Spotify without reinstalling")
        try expect(action.title == "Open Spotify" && !repair.isHidden && repair.isEnabled, "Healthy setup lacks open and repair actions")
        try expect(blockUpdates.state == .on && !apply.isEnabled, "Applied update setting should have no pending changes")
        try expect(componentIcons.count == 3 && componentIcons.allSatisfy { $0.image != nil }, "Product logos did not load for the setup cards")
        try expect(spotifyRequirement.stringValue.contains("desktop app") && spotifyRequirement.stringValue.contains("spotify.com"), "The main setup screen omitted Spotify's required desktop download")
        try expect(refresh.title == "Check again" && logs.title == "Logs" && logs.isEnabled, "Windows-style setup controls are missing")
        logs.performClick(nil); settle()
        try expect(detailsPanel?.isVisible == true && detailsPanel?.title == "Installer logs" && detailsText.string.contains("No setup activity yet") && !copyButton.isEnabled, "Logs cannot open before installation")
        try capture("installer-empty-logs", window: detailsPanel)
        detailsPanel?.orderOut(nil)
        refresh.performClick(nil)
        try expect(!busy && installer == nil && action.title == "Open Spotify", "Check again changed a healthy setup")
        try capture("installer-ready")
        blockUpdates.performClick(nil)
        try expect(blockUpdates.state == .off && apply.isEnabled && pendingStatus.stringValue.contains("Unsaved"), "Checkbox change wasn't shown as pending")
        try expect(setup.updatesBlocked == true && preferences.blockSpotifyUpdates == true, "Pending selection overwrote applied or saved setting")
        try capture("installer-pending-setting")

        tutorialButton.performClick(nil)
        try expect(tutorial?.page == 0 && window.attachedSheet != nil, "Tutorial couldn't be reopened")
        try capture("tutorial-first-page", window: tutorial!.panel)
        tutorial!.next.performClick(nil)
        try expect(tutorial?.page == 1 && !preferences.tutorialCompleted, "Tutorial advanced or completed incorrectly")
        try expect(tutorial!.body.stringValue.contains("spotify.com/download/mac") && tutorial!.body.stringValue.contains("web player"), "Tutorial omitted the Mac desktop download requirement")
        let downloadRange = (tutorial!.body.stringValue as NSString).range(of: "spotify.com/download/mac")
        try expect(tutorial!.body.isSelectable && tutorial!.body.allowsEditingTextAttributes &&
                   tutorial!.body.attributedStringValue.attribute(.link, at: downloadRange.location, effectiveRange: nil) as? URL == URL(string: "https://www.spotify.com/download/mac/"),
                   "Tutorial Spotify download text isn't an interactive official hyperlink")
        try capture("tutorial-spotify-requirement", window: tutorial!.panel)
        tutorial!.close.performClick(nil); settle()
        try expect(tutorial == nil && !preferences.tutorialCompleted, "Closing tutorial incorrectly marked it complete")
        tutorialButton.performClick(nil)
        try expect(tutorial?.page == 0, "Tutorial didn't restart from its first page")
        tutorial!.next.performClick(nil); tutorial!.next.performClick(nil)
        try expect(tutorial?.next.title == "Got it" && !preferences.tutorialCompleted, "Tutorial completed before the final action")
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
        try expect(action.title == "Repair Tagify", "A CLI update hid a required repair")
        preview("update"); settle()
        try expect(updatePanel != nil && !updateCard.isHidden, "Installer update prompt or reminder missing")
        try capture("installer-update-prompt", window: updatePanel)
        dismissUpdate(); settle()
        try expect(updatePanel == nil && !updateCard.isHidden && window.isVisible, "Later removed the update reminder or closed setup")
        updateButton.performClick(nil); settle()
        try expect(updatePanel != nil, "Deferred installer update couldn't be reopened")
        dismissUpdate(); settle()

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
        try expect(fixture.spiceCommands.count == before + 1 && setup.updatesBlocked == false && preferences.blockSpotifyUpdates == false && !apply.isEnabled, "Apply Changes didn't save protection independently")
        fixture.failUpdateSetting = true
        blockUpdates.performClick(nil); apply.performClick(nil)
        try waitForOperation()
        try expect(!errorCard.isHidden && setup.updatesBlocked == false && preferences.blockSpotifyUpdates == false && apply.isEnabled, "Failed setting change lost rollback or the pending choice")
        try capture("installer-setting-recovery")
        fixture.failUpdateSetting = false; retry.performClick(nil)
        try waitForOperation()
        try expect(errorCard.isHidden && setup.updatesBlocked == true && preferences.blockSpotifyUpdates == true && !apply.isEnabled, "Retry didn't save and verify the restored setting")
        installerFactoryOverride = nil
        isPreview = true
        print("Passed \(assertions) native Mac UI assertions: readiness, open without reinstall, pending settings, tutorial dismissal/completion/replay, setup help, progress, recovery, update reminders, small windows, and real window-to-engine installation/setting/retry flows.")
    }
}

#endif
