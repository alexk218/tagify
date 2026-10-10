import AppKit
import UniformTypeIdentifiers
import Darwin

final class InstallerApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let home: URL
    var window: NSWindow!
    var spotify: URL?
    var setup = SetupStatus()
    var preferences = InstallerPreferences()
    var installer: TagifyInstaller?
    var busy = false
    var checkingLocal = false
    var checkingUpdates = false
    var latestTagify: String?
    var latestSpicetify: String?
    var availableUpdate: InstallerUpdate?
    var downloadedUpdate: URL?
    var tutorial: TutorialController?
    var guide: NSPanel?
    var guideOpenButton: NSButton?
    var updatePanel: NSPanel?
    var detailsPanel: NSPanel?
    var diagnostics = ""
    var retryOperation: (() -> Void)?
    var didPromptUpdate = false
    var preferenceSaveFailed = false
    var isPreview = false
    var openSpotifyOverride: (() -> Void)?
    #if INSTALLER_UI_TESTS
    var installerFactoryOverride: ((URL) throws -> TagifyInstaller)?
    #endif
    let heading = installerLabel("Checking your setup…", size: 24, weight: .semibold)
    let intro = installerLabel("You're a few minutes away from tagging your music.", size: 14, color: .secondaryLabelColor)
    let status = installerLabel("", size: 12, color: .secondaryLabelColor)
    let location = installerLabel("", size: 11, color: .secondaryLabelColor)
    let action = installerButton("Install Tagify", target: nil, action: nil)
    let choose = installerButton("Choose Spotify…", target: nil, action: nil)
    let repair = installerButton("Tagify missing? Repair", target: nil, action: nil)
    let refresh = installerButton("Check again", target: nil, action: nil)
    let logs = installerButton("Logs", target: nil, action: nil)
    let tutorialButton = installerButton("Tutorial", target: nil, action: nil)
    let blockUpdates = NSButton(checkboxWithTitle: "Block Spotify updates", target: nil, action: nil)
    let protectionStatus = installerLabel("", size: 13, weight: .medium)
    let pendingStatus = installerLabel("", size: 12, color: .secondaryLabelColor)
    let apply = installerButton("Apply Changes", target: nil, action: nil)
    let updateText = installerLabel("", size: 13, weight: .medium)
    let updateButton = installerButton("Update now", target: nil, action: nil)
    let errorTitle = installerLabel("Setup needs attention", size: 16, weight: .semibold)
    let errorMessage = installerLabel("", size: 13)
    let retry = installerButton("Try again", target: nil, action: nil)
    let details = installerButton("View details", target: nil, action: nil)
    let logButton = installerButton("Open Log", target: nil, action: nil)
    let backupButton = installerButton("Show Backup", target: nil, action: nil)
    let copyButton = installerButton("Copy diagnostics", target: nil, action: nil)
    let detailsText = NSTextView()
    let progress = NSProgressIndicator()
    let scroll = NSScrollView()
    var progressCard: NSView!
    var updateCard: NSView!
    var errorCard: NSView!
    var setupCards: NSView!
    var sourceGuidanceCard: NSView!
    var updateProtectionCard: NSView!
    var componentLabels: [NSTextField] = []
    var componentStates: [NSTextField] = []
    var componentVersions: [NSTextField] = []
    var componentIcons: [NSImageView] = []
    let spotifyRequirement = installerLabel(InstallerTheme.spotifyRequirement, size: 12, color: InstallerTheme.secondary)
    var stageLabels: [NSTextField] = []
    var stageIndicators: [NSTextField] = []
    let green = InstallerTheme.green

    init(home: URL = FileManager.default.homeDirectoryForCurrentUser) { self.home = home; super.init() }
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.2" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let previewState = argument("--preview") ?? ProcessInfo.processInfo.environment["TAGIFY_INSTALLER_PREVIEW"]
        isPreview = previewState != nil
        #if INSTALLER_UI_TESTS
        isPreview = isPreview || argument("--self-test") != nil
        #endif
        buildWindow()
        if isPreview { preview(previewState ?? "ready") }
        else {
            do { preferences = try InstallerPreferences.load(home: home) }
            catch { appendDiagnostic("Couldn't read installer preferences: \(error)") }
            blockUpdates.state = (preferences.blockSpotifyUpdates ?? true) ? .on : .off
            spotify = findSpotify()
            refreshSetup()
            checkUpdates(prompt: true)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if !isPreview && !preferences.tutorialCompleted { showTutorial() }
        if previewState == "tutorial" { showTutorial() }
        #if INSTALLER_UI_TESTS
        if let output = argument("--self-test") {
            Timer.scheduledTimer(withTimeInterval: 0.01, repeats: false) { _ in
                do { try self.runUITests(output: URL(fileURLWithPath: output)); NSApp.terminate(nil) }
                catch { fputs("FAIL: \(error.localizedDescription)\n", stderr); exit(1) }
            }
        }
        #endif
    }

    private func argument(_ name: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: name), CommandLine.arguments.count > index + 1 else { return nil }
        return CommandLine.arguments[index + 1]
    }

    private func connect(_ button: NSButton, _ selector: Selector) { button.target = self; button.action = selector }

    private func buildWindow() {
        let visible = NSScreen.main?.visibleFrame.size ?? NSSize(width: 1000, height: 800)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: min(780, visible.height - 70)), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.minSize = NSSize(width: 560, height: 480)
        window.appearance = NSAppearance(named: .darkAqua)
        window.title = "Tagify Installer"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = InstallerTheme.background
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        let root = window.contentView!
        root.wantsLayer = true
        root.layer?.backgroundColor = window.backgroundColor!.cgColor
        let brand = installerStack([installerLogo("Tagify"), installerLabel("Tagify Manager", size: 17, weight: .semibold), NSView(), installerLabel("v\(Self.version)", size: 12, color: InstallerTheme.secondary)], vertical: false, spacing: 10)

        var rows: [NSView] = []
        for name in ["Spotify", "Spicetify", "Tagify"] {
            let icon = installerLogo(name)
            let title = installerLabel(name, size: 15, weight: .semibold)
            let state = installerLabel("Checking…", size: 13, color: InstallerTheme.secondary)
            let text = installerStack([title, state], spacing: 3)
            let version = installerLabel("", size: 12, color: InstallerTheme.secondary)
            version.setContentHuggingPriority(.required, for: .horizontal)
            version.setContentCompressionResistancePriority(.required, for: .horizontal)
            let row = installerStack([icon, text, NSView(), version], vertical: false, spacing: 14)
            rows.append(installerCard(row, padding: 12))
            componentLabels.append(title); componentStates.append(state); componentVersions.append(version); componentIcons.append(icon)
        }
        connect(repair, #selector(repairTagify))
        connect(refresh, #selector(refreshClicked))
        connect(logs, #selector(showDetails))
        logs.toolTip = "View setup checks and installation logs."
        let setupHeader = installerStack([installerLabel("YOUR SETUP", size: 12, weight: .medium, color: InstallerTheme.secondary), NSView(), logs, refresh], vertical: false, spacing: 8)
        let components = installerStack([setupHeader] + rows, spacing: 6)
        setupCards = components
        for row in [setupHeader] + rows { row.widthAnchor.constraint(equalTo: components.widthAnchor).isActive = true }

        var stages: [NSView] = []
        for name in ["Prepare your setup", "Set up Spicetify", "Install Tagify", "Check everything works"] {
            let mark = installerLabel("○", size: 13, weight: .semibold)
            mark.widthAnchor.constraint(equalToConstant: 20).isActive = true
            let title = installerLabel(name, size: 13)
            stages.append(installerStack([mark, title], vertical: false))
            stageIndicators.append(mark); stageLabels.append(title)
        }
        progress.style = .bar
        progress.isIndeterminate = true
        progress.heightAnchor.constraint(equalToConstant: 6).isActive = true
        connect(details, #selector(showDetails))
        let stageStack = installerStack(stages + [status, progress, details])
        status.widthAnchor.constraint(equalTo: stageStack.widthAnchor).isActive = true
        progress.widthAnchor.constraint(equalTo: stageStack.widthAnchor).isActive = true
        progressCard = installerCard(stageStack)
        progressCard.isHidden = true

        blockUpdates.state = .on
        blockUpdates.font = .systemFont(ofSize: 14, weight: .medium)
        blockUpdates.toolTip = "Spotify updates can remove Tagify. Your saved tags and ratings stay safe. Use Apply Changes to save your choice."
        connect(blockUpdates, #selector(updateBlockingChoice))
        connect(apply, #selector(applyProtection))
        let protectionNote = installerLabel("Spotify updates can remove Tagify. Your saved tags and ratings stay safe. Uncheck to allow updates.", size: 13, color: InstallerTheme.secondary)
        let protectionControls = installerStack([protectionStatus, NSView(), apply], vertical: false, spacing: 12)
        let protection = installerStack([blockUpdates, protectionNote, protectionControls, pendingStatus], spacing: 10)
        protectionControls.widthAnchor.constraint(equalTo: protection.widthAnchor).isActive = true
        protectionStatus.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        protectionNote.widthAnchor.constraint(equalTo: protection.widthAnchor).isActive = true
        pendingStatus.widthAnchor.constraint(equalTo: protection.widthAnchor).isActive = true
        let protectionCard = installerCard(protection)
        updateProtectionCard = protectionCard
        location.lineBreakMode = .byTruncatingMiddle
        connect(choose, #selector(chooseSpotify))
        let spotifyHelp = installerButton("Spotify setup help", target: self, action: #selector(showSpotifyGuide))
        let links = installerStack([choose, spotifyHelp], vertical: false, spacing: 8)
        let sourceGuidance = installerStack([spotifyRequirement, links], spacing: 8)
        sourceGuidanceCard = sourceGuidance
        spotifyRequirement.widthAnchor.constraint(equalTo: sourceGuidance.widthAnchor).isActive = true
        spotifyRequirement.toolTip = "Download Spotify for Mac at https://www.spotify.com/download/mac/. The web player and mobile apps cannot be used for Tagify setup."

        connect(updateButton, #selector(updateInstaller))
        let updateStack = installerStack([updateText, updateButton], spacing: 10)
        updateText.widthAnchor.constraint(equalTo: updateStack.widthAnchor).isActive = true
        updateCard = installerCard(updateStack)
        updateCard.isHidden = true
        connect(retry, #selector(retryLastOperation))
        let errorDetails = installerButton("View details", target: self, action: #selector(showDetails))
        let errorCopy = installerButton("Copy diagnostics", target: self, action: #selector(copyDiagnostics))
        errorTitle.textColor = .systemOrange
        let errorStack = installerStack([errorTitle, errorMessage, installerStack([retry, errorDetails, errorCopy], vertical: false, spacing: 8)])
        errorMessage.widthAnchor.constraint(equalTo: errorStack.widthAnchor).isActive = true
        errorCard = installerCard(errorStack)
        errorCard.isHidden = true

        let content = installerStack([brand, heading, intro, errorCard, components, sourceGuidance, progressCard, protectionCard, updateCard], spacing: 14)
        content.setCustomSpacing(8, after: heading)
        let document = InstallerDocumentView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.documentView = document
        content.translatesAutoresizingMaskIntoConstraints = false
        document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(content)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(scroll)
        NSLayoutConstraint.activate([
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            content.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: document.topAnchor, constant: 14),
            content.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -18)
        ])
        for view in [brand, heading, intro, errorCard!, components, sourceGuidance, progressCard!, protectionCard, updateCard!] {
            view.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        }
        connect(action, #selector(primaryAction))
        action.controlSize = .large
        action.font = .systemFont(ofSize: 15, weight: .semibold)
        (action as? InstallerButton)?.primary = true
        action.heightAnchor.constraint(equalToConstant: 50).isActive = true
        action.keyEquivalent = "\r"
        connect(tutorialButton, #selector(showTutorial))
        let footerLinks = installerStack([tutorialButton, NSView()], vertical: false, spacing: 8)
        let footer = installerStack([action, repair, footerLinks], spacing: 8)
        for view in [action, repair, footerLinks] { view.widthAnchor.constraint(equalTo: footer.widthAnchor).isActive = true }
        footer.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(footer)
        let divider = NSBox(); divider.boxType = .separator; divider.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(divider)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: root.topAnchor), scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: divider.topAnchor, constant: -8),
            divider.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24), divider.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -24),
            divider.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -12),
            footer.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24), footer.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -24),
            footer.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -16)
        ])
    }

    private func findSpotify() -> URL? {
        let configFolder = InstallerPaths(home: home, spotify: URL(fileURLWithPath: "/Applications/Spotify.app")).config
        let config = (try? String(contentsOf: configFolder.appendingPathComponent("config-xpui.ini"), encoding: .utf8)) ?? ""
        var candidates: [URL] = []
        if let configured = TagifyInstaller.iniValue(config, section: "Setting", key: "spotify_path"), configured.hasSuffix("/Contents/Resources") {
            candidates.append(URL(fileURLWithPath: configured).deletingLastPathComponent().deletingLastPathComponent())
        }
        candidates += [URL(fileURLWithPath: "/Applications/Spotify.app"), home.appendingPathComponent("Applications/Spotify.app")]
        if let registered = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.spotify.client") { candidates.append(registered) }
        return candidates.first { NSDictionary(contentsOf: $0.appendingPathComponent("Contents/Info.plist"))?["CFBundleIdentifier"] as? String == "com.spotify.client" }
    }

    @objc func refreshClicked() { refreshSetup(); checkUpdates(prompt: false) }
    func refreshSetup() {
        guard !busy, !checkingLocal else { return }
        if isPreview { render(); return }
        spotify = spotify ?? findSpotify()
        guard let spotify = spotify else { setup = SetupStatus(); render(); return }
        checkingLocal = true; refresh.isEnabled = false
        DispatchQueue.global(qos: .userInitiated).async {
            let state = SetupStatus.inspect(paths: InstallerPaths(home: self.home, spotify: spotify))
            DispatchQueue.main.async {
                self.checkingLocal = false
                guard self.spotify == spotify else { self.refreshSetup(); return }
                self.setup = state
                self.appendDiagnostic("Setup check: Spotify \(state.spotifyVersion ?? "not found"); Spicetify \(state.spicetifyVersion ?? "not installed"); Tagify \(state.tagifyVersion ?? "not installed").")
                self.render()
                if let guide = self.guide {
                    if state.spotifyFound && state.signedIn { self.dismissGuide() }
                    else { guide.title = "Spotify still needs setup"; self.guideOpenButton?.isEnabled = state.spotifyFound }
                }
            }
        }
    }

    func render() {
        guard !busy else { renderProtection(); return }
        setupCards.isHidden = false; sourceGuidanceCard.isHidden = false; updateProtectionCard.isHidden = false
        let update = setup.needsTagifyUpdate(latest: latestTagify)
        let spiceUpdate = setup.needsSpicetifyUpdate(latest: latestSpicetify)
        if !setup.spotifyFound || !setup.signedIn {
            heading.stringValue = "First, set up Spotify."
            intro.stringValue = "Download Spotify for Mac from spotify.com, open it, and sign in. Then return here to install Tagify."
            action.title = "Set up Spotify"
        } else if setup.ready && !update && !spiceUpdate {
            heading.stringValue = "Tagify is ready."
            intro.stringValue = "Open Spotify and choose Tagify to start tagging your music."
            action.title = "Open Spotify"
        } else if update {
            heading.stringValue = "A Tagify update is ready."
            intro.stringValue = "Update to Tagify \(latestTagify ?? ""). Your saved tags and ratings stay in place."
            action.title = "Update Tagify"
        } else if spiceUpdate && setup.ready {
            heading.stringValue = "A setup update is ready."
            intro.stringValue = "Update your Spotify setup to keep Tagify working. Your saved tags and ratings stay in place."
            action.title = "Update setup"
        } else if setup.tagifyVersion != nil {
            heading.stringValue = "Let's bring Tagify back."
            intro.stringValue = "Repair your setup to make Tagify available in Spotify again. Your saved tags stay safe."
            action.title = "Repair Tagify"
        } else {
            heading.stringValue = "Your music, organized."
            intro.stringValue = "Install Tagify in a few minutes. Spotify will briefly close during setup."
            action.title = "Install Tagify"
        }
        componentStates[0].stringValue = setup.spotifyFound ? (setup.signedIn ? "Ready · Desktop app" : "Sign in first") : "Desktop app needed"
        componentStates[1].stringValue = setup.spicetifyVersion == nil ? "Needed for Tagify" : "Ready"
        componentStates[2].stringValue = setup.tagifyApplied ? "Ready" : (setup.tagifyVersion == nil ? "Not installed" : "Needs repair")
        if spiceUpdate { componentStates[1].stringValue = "Update available" }
        if update { componentStates[2].stringValue = "Update available" }
        for (index, version) in [setup.spotifyVersion, setup.spicetifyVersion, setup.tagifyVersion].enumerated() {
            componentVersions[index].stringValue = version ?? "—"
        }
        for (index, ready) in [setup.spotifyFound && setup.signedIn, setup.spicetifyVersion != nil && !spiceUpdate, setup.tagifyApplied && !update].enumerated() {
            componentStates[index].textColor = ready ? green : .systemOrange
        }
        location.stringValue = spotify.map { "Spotify: \($0.path)" } ?? "Choose Spotify if it is installed in a different location."
        repair.isHidden = !setup.ready
        repair.isEnabled = true
        stylePrimaryAction()
        action.isEnabled = !checkingLocal
        choose.isEnabled = true; refresh.isEnabled = !checkingLocal && !checkingUpdates
        blockUpdates.isEnabled = true; tutorialButton.isEnabled = true
        updateButton.isEnabled = !checkingUpdates
        renderProtection()
        window.contentView?.layoutSubtreeIfNeeded()
    }

    private func stylePrimaryAction() {
        action.needsDisplay = true
    }

    func renderProtection() {
        let chosen = blockUpdates.state == .on
        let pending = setup.updatesBlocked.map { $0 != chosen } ?? false
        protectionStatus.stringValue = setup.updatesBlocked.map { $0 ? "Spotify updates are blocked" : "Spotify updates are allowed" } ?? "Update protection couldn't be checked"
        protectionStatus.textColor = setup.updatesBlocked == nil ? .systemOrange : .labelColor
        if !setup.spotifyFound || setup.spicetifyVersion == nil {
            pendingStatus.stringValue = "Your choice will be applied during setup."
        } else if pending {
            pendingStatus.stringValue = "Unsaved change. Choose Apply Changes to \(chosen ? "block" : "allow") Spotify updates. Spotify will briefly close."
        } else if preferenceSaveFailed { pendingStatus.stringValue = "Your setting is applied, but your Mac couldn't remember it. Choose Apply Changes to try again." }
        else { pendingStatus.stringValue = "Your selected setting is applied." }
        apply.isEnabled = !busy && setup.spotifyFound && setup.signedIn && setup.spicetifyVersion != nil && (pending || preferenceSaveFailed || setup.updatesBlocked == nil || (preferences.blockSpotifyUpdates != nil && preferences.blockSpotifyUpdates != chosen))
    }

    @objc func updateBlockingChoice() { renderProtection() }
    @objc func primaryAction() {
        guard !busy else { return }
        if !setup.spotifyFound || !setup.signedIn { showSpotifyGuide(); return }
        if setup.ready && !setup.needsTagifyUpdate(latest: latestTagify) && !setup.needsSpicetifyUpdate(latest: latestSpicetify) {
            if let open = openSpotifyOverride { open() }
            else if !isPreview, let spotify = spotify { NSWorkspace.shared.openApplication(at: spotify, configuration: NSWorkspace.OpenConfiguration()) }
        } else { installTagify() }
    }
    @objc func repairTagify() { installTagify() }
    @objc func retryLastOperation() { retryOperation?() }

    private func beginOperation(_ title: String, stages: Bool) {
        busy = true; retryOperation = nil; errorCard.isHidden = true
        heading.stringValue = title
        intro.stringValue = "Your saved tags stay safe. You can minimize this window while we finish."
        action.title = "Working…"
        stylePrimaryAction()
        for button in [action, choose, repair, refresh, tutorialButton, blockUpdates, apply, updateButton] { button.isEnabled = false }
        progressCard.isHidden = !stages
        setupCards.isHidden = stages; sourceGuidanceCard.isHidden = stages; updateProtectionCard.isHidden = stages
        repair.isHidden = true
        scroll.documentView?.scroll(.zero)
        progress.startAnimation(nil)
        diagnostics = "Tagify Installer \(Self.version) | macOS \(ProcessInfo.processInfo.operatingSystemVersionString)\nSpotify \(setup.spotifyVersion ?? "unknown"); Spicetify \(setup.spicetifyVersion ?? "not installed"); Tagify \(setup.tagifyVersion ?? "not installed")\n"
        detailsText.string = diagnostics
        copyButton.title = "Copy diagnostics"; copyButton.isEnabled = true
    }

    private func endOperation() {
        busy = false
        progress.stopAnimation(nil)
        logButton.isEnabled = installer != nil
        backupButton.isEnabled = installer?.backupURL != nil
        render()
    }

    func updateStep(_ step: Int, _ text: String) {
        let stage = step < 3 ? 0 : min(step - 2, 4)
        status.stringValue = text + (step < 6 ? "…" : "")
        for index in stageIndicators.indices {
            stageIndicators[index].stringValue = index < stage ? "✓" : (index == stage ? "●" : "○")
            stageIndicators[index].textColor = index <= stage ? green : .secondaryLabelColor
            stageLabels[index].textColor = index <= stage ? .labelColor : .secondaryLabelColor
        }
    }

    private func makeInstaller(spotify: URL) throws -> TagifyInstaller {
        let engine: TagifyInstaller
        #if INSTALLER_UI_TESTS
        if let factory = installerFactoryOverride { engine = try factory(spotify) }
        else { engine = try TagifyInstaller(paths: InstallerPaths(home: home, spotify: spotify)) }
        #else
        engine = try TagifyInstaller(paths: InstallerPaths(home: home, spotify: spotify))
        #endif
        engine.progress = { step, text in DispatchQueue.main.async { self.updateStep(step, text) } }
        engine.diagnostic = { text in DispatchQueue.main.async { self.appendDiagnostic(text) } }
        #if INSTALLER_UI_TESTS
        if installerFactoryOverride != nil { installer = engine; return engine }
        #endif
        engine.closeSpotify = {
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.spotify.client")
            for app in running { app.terminate() }
            let deadline = Date().addingTimeInterval(12)
            while running.contains(where: { !$0.isTerminated }), Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
            guard !running.contains(where: { !$0.isTerminated }) else { throw InstallerFailure(message: "Spotify is still open. Quit Spotify completely, then try again.") }
        }
        engine.authorizeSpotify = { resources in
            var outcome: Result<Void, Error> = .success(())
            DispatchQueue.main.sync {
                let alert = NSAlert()
                alert.messageText = "Allow Tagify to update Spotify"
                alert.informativeText = "This copy of Spotify needs your Mac administrator password to allow changes. Setup will continue using your own account."
                alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
                guard alert.runModal() == .alertFirstButtonReturn else {
                    outcome = .failure(InstallerFailure(message: "Setup paused. Allow changes to Spotify when you're ready to try again.")); return
                }
                let quoted = "'" + resources.path.replacingOccurrences(of: "'", with: "'\\''") + "'"
                let acl = "user:\(NSUserName()) allow read,write,append,execute,delete,add_file,add_subdirectory,delete_child,file_inherit,directory_inherit"
                let quotedACL = "'" + acl.replacingOccurrences(of: "'", with: "'\\''") + "'"
                let command = "/bin/chmod -R +a \(quotedACL) \(quoted)"
                let escaped = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
                var error: NSDictionary?
                NSAppleScript(source: "do shell script \"\(escaped)\" with administrator privileges")?.executeAndReturnError(&error)
                if error != nil { outcome = .failure(InstallerFailure(message: "Permission to update Spotify wasn't granted. Try again when you're ready.")) }
            }
            try outcome.get()
        }
        installer = engine
        return engine
    }

    private func rememberProtection(_ value: Bool) {
        var saved = preferences
        saved.blockSpotifyUpdates = value
        do { try saved.save(home: home); preferences = saved; preferenceSaveFailed = false }
        catch {
            preferenceSaveFailed = true
            showFailure("Spotify updates are \(value ? "blocked" : "allowed"), but your choice couldn't be remembered. Check your available disk space and choose Apply Changes again.", error: error, retry: { self.applyProtection() })
        }
    }

    func installTagify() {
        guard !busy, !isPreview, let spotify = spotify else { return }
        let engine: TagifyInstaller
        do { engine = try makeInstaller(spotify: spotify) }
        catch { showFailure("The installation log couldn't be created. Check your available disk space and try again.", error: error, retry: { self.installTagify() }); return }
        let chosen = blockUpdates.state == .on
        beginOperation("Setting up Tagify…", stages: true)
        updateStep(0, "Preparing your setup")
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try engine.install(architecture: Self.architecture, blockSpotifyUpdates: chosen) }
            let state = SetupStatus.inspect(paths: engine.paths)
            DispatchQueue.main.async {
                self.setup = state; self.endOperation()
                switch result {
                case .success:
                    self.rememberProtection(chosen)
                    self.updateStep(6, "Tagify is ready")
                    self.progressCard.isHidden = true
                    if !state.ready { self.showFailure("Setup finished, but Tagify couldn't be confirmed. Choose Repair Tagify to try again.", retry: { self.installTagify() }) }
                case .failure(let error): self.showFailure(error.localizedDescription, error: error, retry: { self.installTagify() })
                }
            }
        }
    }

    @objc func applyProtection() {
        guard !busy, !isPreview, let spotify = spotify else { return }
        let engine: TagifyInstaller
        do { engine = try makeInstaller(spotify: spotify) }
        catch { showFailure("Your update setting couldn't be saved. Check your available disk space and try again.", error: error, retry: { self.applyProtection() }); return }
        let chosen = blockUpdates.state == .on
        beginOperation("Saving your update setting…", stages: false)
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try engine.applySpotifyUpdateSetting(blocked: chosen) }
            let state = SetupStatus.inspect(paths: engine.paths)
            DispatchQueue.main.async {
                self.setup = state; self.endOperation()
                switch result {
                case .success: self.rememberProtection(chosen); self.renderProtection()
                case .failure(let error): self.showFailure((error as? InstallerFailure)?.message ?? "Your update setting couldn't be saved. Check your available disk space and try again.", error: error, retry: { self.applyProtection() })
                }
            }
        }
    }

    @objc func chooseSpotify() {
        let picker = NSOpenPanel()
        picker.title = "Choose Spotify"; picker.message = "Select Spotify's Mac desktop app, downloaded from spotify.com."
        picker.allowedContentTypes = [.applicationBundle]; picker.directoryURL = URL(fileURLWithPath: "/Applications")
        picker.canChooseDirectories = true; picker.treatsFilePackagesAsDirectories = false
        picker.beginSheetModal(for: window) { result in
            if result == .OK, let url = picker.url { self.spotify = url; self.refreshSetup() }
        }
    }

    @objc func showTutorial() {
        guard !busy, window.attachedSheet == nil else { return }
        tutorial = TutorialController(parent: window, completion: {
            self.preferences.tutorialCompleted = true
            if !self.isPreview {
                do { try self.preferences.save(home: self.home) }
                catch { self.appendDiagnostic("Couldn't remember tutorial completion: \(error)") }
            }
        }, dismissed: { self.tutorial = nil; self.offerUpdateIfNeeded() })
    }

    @objc func showSpotifyGuide() {
        guard !busy, window.attachedSheet == nil else { return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 410), styleMask: [.titled], backing: .buffered, defer: false)
        configureInstallerPanel(panel)
        panel.title = "Set up Spotify"
        let text = installerLabel("1. Download Spotify for Mac from spotify.com/download/mac and move it to Applications.\n\n2. Open Spotify, sign in, and leave it open for a minute.\n\n3. Return here and choose Check setup.\n\nTagify works inside Spotify's desktop app. The web player and mobile apps won't work for setup.", size: 14)
        let get = installerButton("Get Spotify", target: self, action: #selector(getSpotify))
        let open = installerButton("Open Spotify", target: self, action: #selector(openSpotifyForSetup)); open.isEnabled = spotify != nil
        let check = installerButton("Check setup", target: self, action: #selector(checkFromGuide))
        let back = installerButton("Back", target: self, action: #selector(dismissGuide)); back.keyEquivalent = "\u{1b}"
        let controls = installerStack([back, NSView(), get, open, check], vertical: false, spacing: 8)
        let stack = installerStack([installerStack([installerLogo("Spotify", size: 32), installerLabel("Set up desktop Spotify.", size: 23, weight: .semibold)], vertical: false), text, NSView(), controls], spacing: 16)
        pinSheet(stack, to: panel)
        text.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        controls.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        guideOpenButton = open
        guide = panel; window.beginSheet(panel)
    }
    @objc func getSpotify() { if !isPreview { NSWorkspace.shared.open(URL(string: "https://www.spotify.com/download/mac/")!) } }
    @objc func openSpotifyForSetup() { if !isPreview, let spotify = spotify { NSWorkspace.shared.openApplication(at: spotify, configuration: NSWorkspace.OpenConfiguration()) } }
    @objc func checkFromGuide() { spotify = spotify ?? findSpotify(); refreshSetup() }
    @objc func dismissGuide() { if let guide = guide { window.endSheet(guide); guide.orderOut(nil) }; guide = nil; guideOpenButton = nil; offerUpdateIfNeeded() }

    private func pinSheet(_ stack: NSStackView, to panel: NSPanel) {
        stack.translatesAutoresizingMaskIntoConstraints = false; panel.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor, constant: -24)
        ])
    }

    func checkUpdates(prompt: Bool) {
        guard !busy, !checkingUpdates, !isPreview else { return }
        checkingUpdates = true; refresh.isEnabled = false; updateButton.isEnabled = false
        DispatchQueue.global(qos: .utility).async {
            let result = Result { try InstallerUpdates.check(installed: Self.version) }
            DispatchQueue.main.async {
                self.checkingUpdates = false
                switch result {
                case .success(let update):
                    if self.availableUpdate?.asset.digest != update?.asset.digest { self.downloadedUpdate = nil }
                    self.availableUpdate = update
                    self.updateText.stringValue = update.map { "Tagify Installer \($0.version.string) is available for your Mac." } ?? ""
                    self.updateCard.isHidden = update == nil
                    self.updateButton.title = "Update now"
                case .failure(let error):
                    self.availableUpdate = nil; self.updateCard.isHidden = false
                    self.updateText.stringValue = "We couldn't check for installer updates. Check again when you're online."
                    self.updateButton.title = "Check again"; self.appendDiagnostic("Installer update check: \(error)")
                }
                self.render()
                if prompt { self.offerUpdateIfNeeded() }
            }
        }
        DispatchQueue.global(qos: .utility).async {
            let result = Result { try InstallerUpdates.latestSpicetify(architecture: Self.architecture) }
            DispatchQueue.main.async {
                switch result {
                case .success(let version): self.latestSpicetify = version
                case .failure(let error): self.appendDiagnostic("Spicetify update check: \(error)")
                }
                self.render()
            }
        }
        DispatchQueue.global(qos: .utility).async {
            let result = Result { try InstallerUpdates.latestTagify() }
            DispatchQueue.main.async {
                switch result {
                case .success(let version): self.latestTagify = version
                case .failure(let error): self.appendDiagnostic("Tagify update check: \(error)")
                }
                self.render()
            }
        }
    }

    func offerUpdateIfNeeded() {
        if availableUpdate != nil && !didPromptUpdate && !busy && window.attachedSheet == nil { showUpdate() }
    }
    @objc func updateInstaller() {
        guard !busy else { return }
        if let downloaded = downloadedUpdate { if !isPreview { NSWorkspace.shared.activateFileViewerSelecting([downloaded]) }; return }
        if availableUpdate != nil { showUpdate() } else { checkUpdates(prompt: true) }
    }
    func showUpdate() {
        guard let update = availableUpdate, window.attachedSheet == nil else { return }
        didPromptUpdate = true
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 450), styleMask: [.titled], backing: .buffered, defer: false)
        configureInstallerPanel(panel)
        panel.title = "Tagify Installer update"
        let notes = NSTextView(frame: NSRect(x: 0, y: 0, width: 500, height: 200)); notes.isEditable = false; notes.font = .systemFont(ofSize: 13); notes.string = String(update.notes.prefix(12000)); notes.textContainerInset = NSSize(width: 8, height: 8); notes.textColor = .labelColor; notes.isVerticallyResizable = true; notes.isHorizontallyResizable = false; notes.autoresizingMask = .width; notes.textContainer?.widthTracksTextView = true
        let notesScroll = NSScrollView(); notesScroll.hasVerticalScroller = true; notesScroll.documentView = notes
        notesScroll.heightAnchor.constraint(equalToConstant: 200).isActive = true
        let later = installerButton("Later", target: self, action: #selector(dismissUpdate))
        let now = installerButton("Update now", target: self, action: #selector(downloadInstaller)); now.keyEquivalent = "\r"
        let info = installerLabel("Download the new Mac installer, then open it to replace this version. Your Tagify setup and saved tags stay in place.", size: 13, color: .secondaryLabelColor)
        let controls = installerStack([later, NSView(), now], vertical: false)
        let stack = installerStack([installerLabel("Installer \(update.version.string) is available.", size: 23, weight: .bold), info, installerLabel("What's new", size: 13, weight: .semibold), notesScroll, controls], spacing: 12)
        pinSheet(stack, to: panel)
        for view in [info, notesScroll, controls] { view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        updatePanel = panel; window.beginSheet(panel)
    }
    @objc func dismissUpdate() { if let panel = updatePanel { window.endSheet(panel); panel.orderOut(nil) }; updatePanel = nil }
    @objc func downloadInstaller() {
        guard !busy, !isPreview, let update = availableUpdate else { return }
        dismissUpdate(); beginOperation("Downloading the new installer…", stages: false)
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try InstallerUpdates.download(update, downloads: self.home.appendingPathComponent("Downloads")) }
            DispatchQueue.main.async {
                self.endOperation()
                switch result {
                case .success(let url):
                    self.downloadedUpdate = url; self.updateText.stringValue = "Your new installer is ready in Downloads. Open it to finish updating."
                    self.updateButton.title = "Show download"
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                case .failure(let error): self.showFailure("The new installer couldn't be downloaded or verified. Check your connection and try again.", error: error, retry: { self.downloadInstaller() })
                }
            }
        }
    }

    func showFailure(_ message: String, error: Error? = nil, retry: @escaping () -> Void) {
        retryOperation = retry; errorMessage.stringValue = message; errorCard.isHidden = false
        if let error = error { appendDiagnostic(String(describing: error)) }
        progressCard.isHidden = true
        render()
        scroll.contentView.scroll(to: .zero)
        scroll.reflectScrolledClipView(scroll.contentView)
    }
    func appendDiagnostic(_ text: String) { diagnostics += text + "\n"; detailsText.string = diagnostics; copyButton.isEnabled = true }
    @objc func showDetails() {
        if let panel = detailsPanel { panel.makeKeyAndOrderFront(nil); return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 650, height: 420), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        configureInstallerPanel(panel)
        panel.title = "Installer logs"; panel.isReleasedWhenClosed = false
        detailsText.frame = NSRect(x: 0, y: 0, width: 600, height: 300)
        detailsText.isVerticallyResizable = true; detailsText.isHorizontallyResizable = false; detailsText.autoresizingMask = .width; detailsText.textContainer?.widthTracksTextView = true
        detailsText.isEditable = false; detailsText.isSelectable = true; detailsText.font = .monospacedSystemFont(ofSize: 11, weight: .regular); detailsText.string = diagnostics.isEmpty ? "No setup activity yet. Use Check again to check your setup." : diagnostics
        detailsText.textContainerInset = NSSize(width: 10, height: 10)
        let logScroll = NSScrollView(); logScroll.hasVerticalScroller = true; logScroll.documentView = detailsText
        logScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 270).isActive = true
        connect(copyButton, #selector(copyDiagnostics)); connect(logButton, #selector(openLog)); connect(backupButton, #selector(openBackup))
        copyButton.isEnabled = !diagnostics.isEmpty
        logButton.isEnabled = installer != nil; backupButton.isEnabled = installer?.backupURL != nil
        let controls = installerStack([copyButton, logButton, backupButton], vertical: false, spacing: 8)
        let stack = installerStack([logScroll, controls]); pinSheet(stack, to: panel)
        logScroll.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        detailsPanel = panel; panel.center(); panel.makeKeyAndOrderFront(nil)
    }
    @objc func copyDiagnostics() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(diagnostics, forType: .string); copyButton.title = "Copied" }
    @objc func openLog() { if let url = installer?.logURL { NSWorkspace.shared.open(url) } }
    @objc func openBackup() { if let url = installer?.backupURL { NSWorkspace.shared.activateFileViewerSelecting([url]) } }

    static var architecture: String {
        var arm64: Int32 = 0; var size = MemoryLayout<Int32>.size
        if sysctlbyname("hw.optional.arm64", &arm64, &size, nil, 0) == 0, arm64 == 1 { return "arm64" }
        return "amd64"
    }

    func preview(_ state: String) {
        isPreview = true
        spotify = URL(fileURLWithPath: "/Applications/Spotify.app")
        setup = SetupStatus(spotifyFound: true, signedIn: true, spotifyVersion: "1.2.85", spicetifyVersion: "2.45.3", tagifyVersion: "3.0.0", tagifyApplied: true, updatesBlocked: true)
        preferences = InstallerPreferences(); preferences.blockSpotifyUpdates = true
        blockUpdates.state = .on; busy = false; errorCard.isHidden = true; progressCard.isHidden = true; updateCard.isHidden = true; latestTagify = nil; latestSpicetify = nil
        render()
        if state == "progress" { beginOperation("Setting up Tagify…", stages: true); updateStep(4, "Installing Tagify") }
        else if state == "failure" { showFailure("Spotify is still open. Quit Spotify completely, then try again.", retry: {}) }
        else if state == "missing" { spotify = nil; setup = SetupStatus(); render() }
        else if state == "repair" { setup.tagifyApplied = false; render() }
        else if state == "tagify-update" { latestTagify = "3.0.1"; render() }
        else if state == "spicetify-update" { latestSpicetify = "2.45.4"; render() }
        else if state == "pending" { blockUpdates.state = .off; renderProtection() }
        else if state == "small" { window.setContentSize(NSSize(width: 560, height: 458)); render() }
        else if state == "update" {
            let asset = InstallerRelease.Asset(name: "TagifyInstaller-mac.dmg", browser_download_url: URL(string: "https://github.com/alexk218/tagify-installer/releases/download/v1.0.2/TagifyInstaller-mac.dmg")!, digest: "sha256:" + String(repeating: "a", count: 64))
            availableUpdate = InstallerUpdate(version: StableVersion("1.0.2")!, notes: "• Clear setup status and a separate repair option.\n• Reopen the tutorial at any time.\n• Save your Spotify update setting without reinstalling Tagify.", asset: asset)
            updateText.stringValue = "Tagify Installer 1.0.2 is available for your Mac."; updateCard.isHidden = false
            showUpdate()
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { sender != window || !busy }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { busy ? .terminateCancel : .terminateNow }
}

let application = NSApplication.shared
#if INSTALLER_UI_TESTS
let testHome = CommandLine.arguments.contains("--self-test") ? FileManager.default.temporaryDirectory.appendingPathComponent("tagify-ui-tests-\(UUID().uuidString)") : FileManager.default.homeDirectoryForCurrentUser
let delegate = InstallerApp(home: testHome)
#else
let delegate = InstallerApp()
#endif
application.delegate = delegate
application.run()
