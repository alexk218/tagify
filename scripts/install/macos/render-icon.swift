import AppKit

let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        NSColor(srgbRed: 0.065, green: 0.075, blue: 0.085, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 30, y: 30, width: 964, height: 964), xRadius: 216, yRadius: 216).fill()
        let tag = NSBezierPath()
        tag.move(to: NSPoint(x: 230, y: 730))
        tag.line(to: NSPoint(x: 520, y: 730))
        tag.line(to: NSPoint(x: 805, y: 445))
        tag.line(to: NSPoint(x: 510, y: 150))
        tag.line(to: NSPoint(x: 230, y: 430))
        tag.close()
        NSColor(srgbRed: 0.36, green: 0.91, blue: 0.58, alpha: 1).setFill()
        tag.fill()
        NSColor(srgbRed: 0.065, green: 0.075, blue: 0.085, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 302, y: 588, width: 76, height: 76)).fill()
        image.unlockFocus()
        let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try representation.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
