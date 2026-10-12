import AppKit

let tagPoints = [NSPoint(x: 230, y: 730), NSPoint(x: 520, y: 730), NSPoint(x: 805, y: 445), NSPoint(x: 510, y: 150), NSPoint(x: 230, y: 430)]
let hole = NSRect(x: 302, y: 588, width: 76, height: 76)
var twiceArea: CGFloat = 0
var weightedCenter = NSPoint.zero
for index in tagPoints.indices {
    let a = tagPoints[index], b = tagPoints[(index + 1) % tagPoints.count]
    let cross = a.x * b.y - b.x * a.y
    twiceArea += cross
    weightedCenter.x += (a.x + b.x) * cross
    weightedCenter.y += (a.y + b.y) * cross
}
let area = abs(twiceArea / 2)
let holeArea = CGFloat.pi * hole.width * hole.height / 4
let paintedCenter = NSPoint(
    x: (area * weightedCenter.x / (3 * twiceArea) - holeArea * hole.midX) / (area - holeArea),
    y: (area * weightedCenter.y / (3 * twiceArea) - holeArea * hole.midY) / (area - holeArea)
)

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
        tag.move(to: tagPoints[0])
        for point in tagPoints.dropFirst() { tag.line(to: point) }
        tag.close()
        // Center the painted area, accounting for the asymmetric silhouette and its hole.
        // Outline centering makes this tag look too far toward the upper-left.
        context.translateBy(x: 512 - paintedCenter.x, y: 512 - paintedCenter.y)
        NSColor(srgbRed: 0.36, green: 0.91, blue: 0.58, alpha: 1).setFill()
        tag.fill()
        NSColor(srgbRed: 0.065, green: 0.075, blue: 0.085, alpha: 1).setFill()
        NSBezierPath(ovalIn: hole).fill()
        image.unlockFocus()
        let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let suffix = scale == 2 ? "@2x" : ""
        try representation.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
