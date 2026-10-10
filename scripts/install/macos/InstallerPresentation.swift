import AppKit

final class InstallerDocumentView: NSView { override var isFlipped: Bool { true } }

enum InstallerTheme {
    static let background = NSColor(srgbRed: 18 / 255, green: 18 / 255, blue: 18 / 255, alpha: 1)
    static let card = NSColor(srgbRed: 10 / 255, green: 10 / 255, blue: 10 / 255, alpha: 1)
    static let border = NSColor(white: 0.15, alpha: 1)
    static let secondary = NSColor(white: 0.70, alpha: 1)
    static let green = NSColor(srgbRed: 29 / 255, green: 185 / 255, blue: 84 / 255, alpha: 1)
    static let spotifyRequirement = "Use the Spotify desktop app downloaded from spotify.com."
}

func installerLogo(_ name: String, size: CGFloat = 28) -> NSImageView {
    let url = Bundle.main.url(forResource: name.lowercased() + "-logo", withExtension: "png", subdirectory: "Assets")
    var image = url.flatMap { NSImage(contentsOf: $0) }
    #if INSTALLER_UI_TESTS
    // The command-line UI harness uses the exact source assets; packaged apps use bundled copies.
    let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Assets/\(name.lowercased())-logo.png")
    image = image ?? NSImage(contentsOf: source)
    #endif
    let view = NSImageView()
    view.image = image
    view.imageScaling = .scaleProportionallyUpOrDown
    view.setAccessibilityLabel(name)
    view.widthAnchor.constraint(equalToConstant: size).isActive = true
    view.heightAnchor.constraint(equalToConstant: size).isActive = true
    return view
}

// Retain NSButton's keyboard, accessibility and target/action behavior while matching the Windows controls.
final class InstallerButton: NSButton {
    var primary = false { didSet { invalidateIntrinsicContentSize(); needsDisplay = true } }
    private var hovering = false
    private var hoverArea: NSTrackingArea?

    override var intrinsicContentSize: NSSize {
        let width = (title as NSString).size(withAttributes: [.font: font ?? NSFont.systemFont(ofSize: 12)]).width
        return NSSize(width: ceil(width) + 28, height: primary ? 50 : 32)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area = hoverArea { removeTrackingArea(area) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(area); hoverArea = area
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovering = false; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        let pressed = cell?.isHighlighted == true
        let surface: NSColor
        if !isEnabled { surface = NSColor(white: 0.10, alpha: 1) }
        else if primary { surface = pressed ? NSColor(srgbRed: 26 / 255, green: 163 / 255, blue: 74 / 255, alpha: 1) : hovering ? NSColor(srgbRed: 30 / 255, green: 215 / 255, blue: 96 / 255, alpha: 1) : InstallerTheme.green }
        else { surface = NSColor(white: pressed ? 0.06 : hovering ? 0.10 : 0.045, alpha: 1) }
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: primary ? 10 : 8, yRadius: primary ? 10 : 8)
        surface.setFill(); path.fill()
        if !primary { InstallerTheme.border.setStroke(); path.lineWidth = 1; path.stroke() }
        let color = !isEnabled ? NSColor(white: 0.43, alpha: 1) : primary ? NSColor(srgbRed: 7 / 255, green: 26 / 255, blue: 13 / 255, alpha: 1) : NSColor(white: 0.90, alpha: 1)
        let label = NSAttributedString(string: title, attributes: [.font: font ?? NSFont.systemFont(ofSize: 12), .foregroundColor: color])
        let size = label.size()
        label.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }
    override func drawFocusRingMask() {
        NSBezierPath(roundedRect: bounds, xRadius: primary ? 10 : 8, yRadius: primary ? 10 : 8).fill()
    }
    override var focusRingMaskBounds: NSRect { bounds }
}

func configureInstallerPanel(_ panel: NSPanel) {
    panel.appearance = NSAppearance(named: .darkAqua)
    panel.backgroundColor = InstallerTheme.background
    panel.contentView?.wantsLayer = true
    panel.contentView?.layer?.backgroundColor = panel.backgroundColor.cgColor
}

func installerLabel(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSTextField {
    let view = NSTextField(wrappingLabelWithString: text)
    view.font = .systemFont(ofSize: size, weight: weight)
    view.textColor = color
    return view
}

func installerButton(_ title: String, target: AnyObject?, action: Selector?) -> NSButton {
    let button = InstallerButton(title: title, target: target, action: action)
    button.setButtonType(.momentaryPushIn)
    button.isBordered = false
    button.font = .systemFont(ofSize: 12, weight: .medium)
    button.focusRingType = .exterior
    return button
}

func installerStack(_ views: [NSView], vertical: Bool = true, spacing: CGFloat = 12) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = vertical ? .vertical : .horizontal
    stack.alignment = vertical ? .leading : .centerY
    stack.spacing = spacing
    return stack
}

func installerCard(_ contents: NSView, padding: CGFloat = 16) -> NSView {
    let card = NSView()
    card.wantsLayer = true
    card.layer?.backgroundColor = InstallerTheme.card.cgColor
    card.layer?.borderColor = InstallerTheme.border.cgColor
    card.layer?.borderWidth = 1
    card.layer?.cornerRadius = 10
    contents.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(contents)
    NSLayoutConstraint.activate([
        contents.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: padding),
        contents.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -padding),
        contents.topAnchor.constraint(equalTo: card.topAnchor, constant: padding),
        contents.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -padding)
    ])
    return card
}

final class TutorialController: NSObject {
    let panel: NSPanel
    let heading = installerLabel("", size: 24, weight: .bold)
    let body = installerLabel("", size: 15)
    let pageLabel = installerLabel("", size: 12, color: .secondaryLabelColor)
    let next = installerButton("Next", target: nil, action: nil)
    let back = installerButton("Back", target: nil, action: nil)
    let close = installerButton("Close tutorial", target: nil, action: nil)
    private(set) var page = 0
    private let completion: () -> Void
    private let dismissed: () -> Void
    private let pages = [
        ("Your music, organized.", "Tagify adds tags, ratings, and filters to your music inside Spotify. Use this installer to get started or bring Tagify back after a Spotify update."),
        ("A few minutes to get started.", "Download the Mac desktop app from spotify.com/download/mac. Tagify works inside the desktop app, so the web player and mobile apps won't work for setup. Open Spotify and sign in first, then choose Install Tagify.\n\nSpotify briefly closes during setup. Your saved tags, ratings, themes, and other apps stay in place. Block Spotify updates is on by default; you can change it here any time."),
        ("Find Tagify in Spotify.", "When setup finishes, choose Open Spotify, then choose Tagify in Spotify.\n\nIf Tagify disappears, return to this installer and choose Tagify missing? Repair. Reopen this guide any time with Tutorial.")
    ]

    init(parent: NSWindow, completion: @escaping () -> Void, dismissed: @escaping () -> Void) {
        self.completion = completion
        self.dismissed = dismissed
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 540, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        super.init()
        configureInstallerPanel(panel)
        panel.title = "Tagify tutorial"
        next.target = self; next.action = #selector(advance)
        back.target = self; back.action = #selector(previous)
        close.target = self; close.action = #selector(dismiss)
        body.allowsEditingTextAttributes = true
        body.isSelectable = true
        next.keyEquivalent = "\r"
        close.keyEquivalent = "\u{1b}"
        let controls = installerStack([close, NSView(), back, next], vertical: false)
        let stack = installerStack([installerLogo("Tagify", size: 36), pageLabel, heading, body, NSView(), controls], spacing: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor, constant: -24),
            body.widthAnchor.constraint(equalTo: stack.widthAnchor),
            controls.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        render()
        parent.beginSheet(panel)
    }

    private func render() {
        heading.stringValue = pages[page].0
        let text = pages[page].1
        let attributed = NSMutableAttributedString(string: text, attributes: [
            .font: body.font ?? NSFont.systemFont(ofSize: 15),
            .foregroundColor: body.textColor ?? NSColor.labelColor
        ])
        if page == 1 {
            let range = (text as NSString).range(of: "spotify.com/download/mac")
            attributed.addAttributes([
                .link: URL(string: "https://www.spotify.com/download/mac/")!,
                .foregroundColor: NSColor.linkColor,
                .underlineStyle: NSUnderlineStyle.single.rawValue
            ], range: range)
        }
        body.attributedStringValue = attributed
        pageLabel.stringValue = "\(page + 1) of \(pages.count)"
        back.isEnabled = page > 0
        next.title = page == pages.count - 1 ? "Got it" : "Next"
    }
    @objc func advance() {
        if page < pages.count - 1 { page += 1; render() }
        else { completion(); dismiss() }
    }
    @objc func previous() { if page > 0 { page -= 1; render() } }
    @objc func dismiss() {
        panel.sheetParent?.endSheet(panel)
        panel.orderOut(nil)
        dismissed()
    }
}
