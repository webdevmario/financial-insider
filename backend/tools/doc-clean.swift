// doc-clean: turn phone photos of paper (a PDF of photos, or JPG/PNG/HEIC/TIFF) into a clean, small,
// searchable PDF that reads like a flatbed scan. Uses only what ships with macOS (Vision, Core Image,
// Accelerate, PDFKit), so there's nothing to install.
//
// Per page: find the sheet and undo the perspective (crop away the table or car seat), turn it upright,
// straighten small tilts, size it to Letter when it's a Letter sheet, flatten shadows and tints to white
// paper with dark text, then OCR it and lay the text invisibly over the image so it can be searched,
// selected and read back.
//
//   doc-clean <input> <outdir> [--name stem] [--pages "1;2-5"] [--mode gray|bw|color]
//             [--rotate "3:90,4:180"] [--no-crop] [--dpi 200] [--quality 0.6] [--force]
//
// A PDF that already carries real text (an emailed invoice, a dealer's e-contract) isn't a photo: it's
// left alone, and the report just has its text with "digital": true. --force cleans it anyway.
// --pages splits the input into several PDFs (groups separated by ";", pages left out are dropped).
// --rotate adds clockwise degrees to a page after auto-orientation, for the rare page it gets wrong.
// Prints a JSON report to stdout: per page what was done and the text read, per part the file written.
// The input is never changed.

import Accelerate
import CoreImage
import CoreText
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import Vision

// MARK: Options

struct Options {
  var input = ""
  var outDir = ""
  var name = ""
  var groups: [[Int]]? = nil
  var mode = "gray"
  var crop = true
  var dpi = 200.0
  var quality = 0.6
  var extraRotation: [Int: Int] = [:]
  var force = false
}

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

func parsePages(_ s: String) -> [[Int]] {
  s.split(separator: ";").map { group in
    group.split(separator: ",").flatMap { part -> [Int] in
      let ends = part.split(separator: "-").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
      if ends.count == 2, ends[0] <= ends[1] { return Array(ends[0]...ends[1]) }
      if ends.count == 1 { return [ends[0]] }
      fail("Bad --pages part: \(part)")
    }
  }
}

func parseOptions() -> Options {
  var o = Options()
  var args = Array(CommandLine.arguments.dropFirst())
  var positional: [String] = []
  while !args.isEmpty {
    let a = args.removeFirst()
    func value() -> String {
      guard !args.isEmpty else { fail("\(a) needs a value") }
      return args.removeFirst()
    }
    switch a {
    case "--name": o.name = value()
    case "--pages": o.groups = parsePages(value())
    case "--mode": o.mode = value()
    case "--no-crop": o.crop = false
    case "--force": o.force = true
    case "--dpi": o.dpi = Double(value()) ?? 200
    case "--quality": o.quality = Double(value()) ?? 0.6
    case "--rotate":
      for pair in value().split(separator: ",") {
        let kv = pair.split(separator: ":").compactMap { Int($0) }
        if kv.count == 2 { o.extraRotation[kv[0]] = ((kv[1] % 360) + 360) % 360 }
      }
    default: positional.append(a)
    }
  }
  guard positional.count == 2 else {
    fail("usage: doc-clean <input> <outdir> [--name stem] [--pages \"1;2-5\"] [--mode gray|bw|color] [--rotate \"3:90\"] [--no-crop]")
  }
  guard ["gray", "bw", "color"].contains(o.mode) else { fail("--mode is gray, bw or color") }
  o.input = positional[0]
  o.outDir = positional[1]
  if o.name.isEmpty { o.name = URL(fileURLWithPath: o.input).deletingPathExtension().lastPathComponent }
  return o
}

// MARK: Loading

let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let rgbSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let graySpace = CGColorSpaceCreateDeviceGray()

/// Long side of a page as loaded; plenty for 200 dpi Letter output
let loadLongSide = 3600.0

func renderPDFPage(_ page: PDFPage) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  let turned = page.rotation % 180 != 0
  let w = turned ? box.height : box.width
  let h = turned ? box.width : box.height
  let scale = min(loadLongSide / max(w, h), 4)
  let pw = Int((w * scale).rounded()), ph = Int((h * scale).rounded())
  guard let ctx = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: 0,
                            space: rgbSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(gray: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
  ctx.interpolationQuality = .high
  ctx.scaleBy(x: scale, y: scale)
  ctx.concatenate(page.transform(for: .mediaBox))
  page.draw(with: .mediaBox, to: ctx)
  return ctx.makeImage()
}

func loadPages(_ path: String) -> [CGImage] {
  let url = URL(fileURLWithPath: path)
  if url.pathExtension.lowercased() == "pdf" {
    guard let doc = PDFDocument(url: url) else { fail("Can't open \(path) as a PDF") }
    return (0..<doc.pageCount).compactMap { doc.page(at: $0).flatMap(renderPDFPage) }
  }
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { fail("Can't open \(path) as an image") }
  // The thumbnail path applies the EXIF orientation a phone photo carries
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: Int(loadLongSide),
  ]
  return (0..<CGImageSourceGetCount(src)).compactMap {
    CGImageSourceCreateThumbnailAtIndex(src, $0, opts as CFDictionary)
  }
}

// MARK: Geometry

func render(_ image: CIImage) -> CGImage {
  guard let cg = ciContext.createCGImage(image, from: image.extent.integral, format: .RGBA8, colorSpace: rgbSpace) else {
    fail("Core Image couldn't render a page")
  }
  return cg
}

func quadArea(_ o: VNRectangleObservation) -> Double {
  let p = [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft]
  var a = 0.0
  for i in 0..<4 {
    let j = (i + 1) % 4
    a += Double(p[i].x * p[j].y - p[j].x * p[i].y)
  }
  return abs(a) / 2
}

/// The sheet of paper in the photo, when it stands clearly apart from the background. A photo already
/// cropped close to the paper gets no quad here (Vision returns the whole frame at zero confidence);
/// trimEdges handles its leftover slivers. The rectangle detector isn't used: it locks onto tables.
func findSheet(_ image: CGImage) -> VNRectangleObservation? {
  let seg = VNDetectDocumentSegmentationRequest()
  try? VNImageRequestHandler(cgImage: image).perform([seg])
  guard let q = seg.results?.first, q.confidence >= 0.5 else { return nil }
  let area = quadArea(q)
  return area >= 0.25 && area < 0.97 ? q : nil
}

/// Crop and flatten the sheet, pulled in a hair so no sliver of table survives the edge
func straighten(_ image: CIImage, _ q: VNRectangleObservation) -> CIImage {
  let w = image.extent.width, h = image.extent.height
  let pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]
  let cx = pts.map(\.x).reduce(0, +) / 4, cy = pts.map(\.y).reduce(0, +) / 4
  let inset: CGFloat = 0.006
  func v(_ p: CGPoint) -> CIVector {
    CIVector(x: (p.x + (cx - p.x) * inset * 2) * w, y: (p.y + (cy - p.y) * inset * 2) * h)
  }
  let f = CIFilter(name: "CIPerspectiveCorrection")!
  f.setValue(image, forKey: kCIInputImageKey)
  f.setValue(v(q.topLeft), forKey: "inputTopLeft")
  f.setValue(v(q.topRight), forKey: "inputTopRight")
  f.setValue(v(q.bottomRight), forKey: "inputBottomRight")
  f.setValue(v(q.bottomLeft), forKey: "inputBottomLeft")
  let out = f.outputImage!
  return out.transformed(by: CGAffineTransform(translationX: -out.extent.minX, y: -out.extent.minY))
}

func rotate(_ image: CIImage, clockwise degrees: Int) -> CIImage {
  switch degrees {
  case 90: return image.oriented(.right)
  case 180: return image.oriented(.down)
  case 270: return image.oriented(.left)
  default: return image
  }
}

func scaled(_ image: CIImage, longSide: Double) -> CIImage {
  let s = min(1, longSide / Double(max(image.extent.width, image.extent.height)))
  return image.transformed(by: CGAffineTransform(scaleX: s, y: s))
}

func textObservations(_ image: CGImage, accurate: Bool) -> [VNRecognizedTextObservation] {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = accurate ? .accurate : .fast
  req.usesLanguageCorrection = accurate
  req.recognitionLanguages = ["en-US"]
  try? VNImageRequestHandler(cgImage: image).perform([req])
  return req.results ?? []
}

/// How much confident, word-like text the recognizer reads at this orientation
func readability(_ obs: [VNRecognizedTextObservation]) -> Double {
  obs.reduce(0) { sum, o in
    guard let c = o.topCandidates(1).first else { return sum }
    let letters = c.string.filter(\.isLetter).count
    return sum + Double(c.confidence) * Double(letters)
  }
}

/// Clockwise turn that puts the text upright: the turn the recognizer reads the most text at
func orientation(_ image: CIImage) -> Int {
  let small = scaled(image, longSide: 1400)
  var best = (turn: 0, score: -1.0)
  for turn in [0, 90, 180, 270] {
    let score = readability(textObservations(render(rotate(small, clockwise: turn)), accurate: false))
    if score > best.score { best = (turn, score) }
  }
  return best.turn
}

/// Rotate by a small angle (degrees, counterclockwise positive) about the center, filling corners with white
func deskew(_ image: CIImage, degrees: Double) -> CIImage {
  let ext = image.extent
  let turned = image.transformed(by: CGAffineTransform(translationX: -ext.midX, y: -ext.midY)
    .concatenating(CGAffineTransform(rotationAngle: degrees * .pi / 180))
    .concatenating(CGAffineTransform(translationX: ext.midX, y: ext.midY)))
  let white = CIImage(color: .white).cropped(to: ext)
  return turned.composited(over: white).cropped(to: ext)
}

/// Pixels of a CIImage drawn at a given size, RGBA8
func rgba(_ image: CIImage, width: Int, height: Int) -> [UInt8] {
  let sized = image.transformed(by: CGAffineTransform(scaleX: Double(width) / image.extent.width,
                                                      y: Double(height) / image.extent.height))
  var px = [UInt8](repeating: 255, count: width * height * 4)
  px.withUnsafeMutableBytes { buf in
    ciContext.render(sized, toBitmap: buf.baseAddress!, rowBytes: width * 4,
                     bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .RGBA8, colorSpace: rgbSpace)
  }
  return px
}

/// Tilt of the text lines (degrees, counterclockwise positive): the angle at which rows of ink line up
/// best, i.e. the row profile of dark pixels is the most peaked. Classic projection-profile deskew.
func textTilt(_ image: CIImage) -> Double {
  let small = scaled(image, longSide: 1000)
  let w = Int(small.extent.width), h = Int(small.extent.height)
  guard w > 50, h > 50 else { return 0 }
  var g = toGray(small, width: w, height: h)
  flatten(&g)
  var ink: [(Double, Double)] = []
  // Ignore an outer margin, where leftover background would swamp the text
  let mx = w / 12, my = h / 12
  for y in my..<(h - my) {
    for x in mx..<(w - mx) where g.px[y * w + x] < 110 {
      ink.append((Double(x) - Double(w) / 2, Double(y) - Double(h) / 2))
    }
  }
  guard ink.count > 500 else { return 0 }
  func score(_ deg: Double) -> Double {
    let t = deg * .pi / 180, s = sin(t), c = cos(t)
    var bins = [Double](repeating: 0, count: h * 2 + 2)
    for (x, y) in ink {
      let r = Int(x * s + y * c) + h + 1
      if r >= 0 && r < bins.count { bins[r] += 1 }
    }
    return bins.reduce(0) { $0 + $1 * $1 }
  }
  var best = (deg: 0.0, score: score(0))
  for step in stride(from: -50, through: 50, by: 1) where step != 0 {
    let d = Double(step) * 0.1
    let sc = score(d)
    if sc > best.score { best = (d, sc) }
  }
  // Rows run bottom-up in pixel space, so a positive best angle means text tilted clockwise
  return -best.deg
}

/// Whiten what's left of the table or carpet along the edges of a photo cropped close to the paper.
/// First whole rows and columns that are mostly not paper are trimmed from each side (up to 10%), then
/// any leftover wedge of background touching the edge (up to 3% in) is flood-filled away. Paper color is
/// read from the middle of the page; a blur keeps text and table lines from counting as background.
func edgeMask(_ image: CIImage, width w: Int, height h: Int) -> [Bool] {
  let blurred = image.clampedToExtent().applyingGaussianBlur(sigma: Double(max(w, h)) / 400).cropped(to: image.extent)
  let px = rgba(blurred, width: w, height: h)
  func channel(_ c: Int) -> UInt8 {
    var v: [UInt8] = []
    for y in stride(from: h / 5, to: h * 4 / 5, by: 3) {
      for x in stride(from: w / 5, to: w * 4 / 5, by: 3) { v.append(px[(y * w + x) * 4 + c]) }
    }
    v.sort()
    return v[v.count * 3 / 4]  // upper quartile: paper, not text
  }
  let paper = [channel(0), channel(1), channel(2)].map(Double.init)
  var bg = [Bool](repeating: false, count: w * h)
  for i in 0..<(w * h) {
    let dr = Double(px[i * 4]) - paper[0], dg = Double(px[i * 4 + 1]) - paper[1], db = Double(px[i * 4 + 2]) - paper[2]
    bg[i] = (dr * dr + dg * dg + db * db).squareRoot() > 60
  }
  var mask = [Bool](repeating: false, count: w * h)
  func rowBg(_ y: Int) -> Bool { (0..<w).filter { bg[y * w + $0] }.count > w * 3 / 5 }
  func colBg(_ x: Int) -> Bool { (0..<h).filter { bg[$0 * w + x] }.count > h * 3 / 5 }
  var top = 0, bottom = 0, left = 0, right = 0
  while top < h / 10 && rowBg(top) { top += 1 }
  while bottom < h / 10 && rowBg(h - 1 - bottom) { bottom += 1 }
  while left < w / 10 && colBg(left) { left += 1 }
  while right < w / 10 && colBg(w - 1 - right) { right += 1 }
  for y in 0..<h {
    for x in 0..<w where y < top || y >= h - bottom || x < left || x >= w - right { mask[y * w + x] = true }
  }
  // Flood from the trimmed edges and the outer frame through background, staying in a thin band
  let band = max(w, h) * 3 / 100
  var stack: [Int] = []
  for y in 0..<h {
    for x in 0..<w {
      let i = y * w + x
      let frame = x == 0 || y == 0 || x == w - 1 || y == h - 1
      if frame && bg[i] { mask[i] = true }
      if mask[i] { stack.append(i) }
    }
  }
  func inBand(_ x: Int, _ y: Int) -> Bool {
    x < left + band || x >= w - right - band || y < top + band || y >= h - bottom - band
  }
  while let i = stack.popLast() {
    let x = i % w, y = i / w
    for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
      guard nx >= 0, ny >= 0, nx < w, ny < h else { continue }
      let j = ny * w + nx
      if !mask[j] && bg[j] && inBand(nx, ny) {
        mask[j] = true
        stack.append(j)
      }
    }
  }
  return mask
}

// MARK: Tone

struct Gray {
  var w: Int, h: Int
  var px: [UInt8]
}

func toGray(_ image: CIImage, width: Int, height: Int) -> Gray {
  let sx = Double(width) / image.extent.width, sy = Double(height) / image.extent.height
  let sized = image.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
  var px = [UInt8](repeating: 255, count: width * height)
  px.withUnsafeMutableBytes { buf in
    ciContext.render(sized, toBitmap: buf.baseAddress!, rowBytes: width, bounds: CGRect(x: 0, y: 0, width: width, height: height),
                     format: .L8, colorSpace: graySpace)
  }
  return Gray(w: width, h: height, px: px)
}

func withBuffer<R>(_ px: inout [UInt8], _ w: Int, _ h: Int, _ body: (inout vImage_Buffer) -> R) -> R {
  px.withUnsafeMutableBytes { raw in
    var b = vImage_Buffer(data: raw.baseAddress!, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    return body(&b)
  }
}

/// Paper brightness under each pixel: text removed with a max filter, then smoothed, at quarter size
func paperLevel(_ g: Gray) -> [UInt8] {
  let f = 4
  let sw = max(8, g.w / f), sh = max(8, g.h / f)
  var src = g.px
  var small = [UInt8](repeating: 0, count: sw * sh)
  var maxed = small, blurred = small
  var full = [UInt8](repeating: 255, count: g.w * g.h)
  withBuffer(&src, g.w, g.h) { s in
    withBuffer(&small, sw, sh) { d in _ = vImageScale_Planar8(&s, &d, nil, vImage_Flags(kvImageHighQualityResampling)) }
  }
  withBuffer(&small, sw, sh) { s in
    withBuffer(&maxed, sw, sh) { d in _ = vImageMax_Planar8(&s, &d, nil, 0, 0, 11, 11, vImage_Flags(kvImageNoFlags)) }
  }
  withBuffer(&maxed, sw, sh) { s in
    withBuffer(&blurred, sw, sh) { d in
      _ = vImageBoxConvolve_Planar8(&s, &d, nil, 0, 0, 15, 15, 0, vImage_Flags(kvImageEdgeExtend))
    }
  }
  withBuffer(&blurred, sw, sh) { s in
    withBuffer(&full, g.w, g.h) { d in _ = vImageScale_Planar8(&s, &d, nil, vImage_Flags(kvImageHighQualityResampling)) }
  }
  return full
}

/// White paper, dark text: divide out uneven light and tint, then stretch so paper is pure white
func flatten(_ g: inout Gray) {
  let bg = paperLevel(g)
  var hist = [Int](repeating: 0, count: 256)
  for i in 0..<g.px.count {
    let b = max(Int(bg[i]), 24)
    let v = min(255, Int(g.px[i]) * 255 / b)
    g.px[i] = UInt8(v)
    hist[v] += 1
  }
  // Black point: the darkest 0.5% of ink, never lighter than 110 so a faint page isn't blown out
  var acc = 0, black = 0
  let cut = g.px.count / 200
  for v in 0..<256 {
    acc += hist[v]
    if acc >= cut { black = min(v, 110); break }
  }
  let white = 222.0, gamma = 1.35
  var lut = [UInt8](repeating: 255, count: 256)
  for v in 0..<256 {
    let t = max(0, min(1, (Double(v) - Double(black)) / (white - Double(black))))
    lut[v] = UInt8((pow(t, gamma) * 255).rounded())
  }
  for i in 0..<g.px.count { g.px[i] = lut[Int(g.px[i])] }
}

/// Whiten anything that isn't clearly darker than its surroundings: the soft gray halos a phone camera
/// leaves around bold text, paper texture and faint shadows. Ink keeps its gray edges, so text stays smooth.
func clearHaze(_ g: inout Gray) {
  var src = g.px
  var mean = [UInt8](repeating: 255, count: g.px.count)
  let k = UInt32(max(15, (g.w / 60) | 1))  // ~28 px at 200 dpi: a bit more than a text line
  withBuffer(&src, g.w, g.h) { s in
    withBuffer(&mean, g.w, g.h) { d in _ = vImageBoxConvolve_Planar8(&s, &d, nil, 0, 0, k, k, 0, vImage_Flags(kvImageEdgeExtend)) }
  }
  let soft = 8.0, hard = 34.0
  for i in 0..<g.px.count {
    let v = Double(g.px[i]), m = Double(mean[i])
    let t = max(0, min(1, (m - v - soft) / (hard - soft)))
    // Very dark pixels are ink whatever their neighbors (inside bold strokes the local mean is dark too)
    let w = v < 90 ? 1 : t
    g.px[i] = UInt8((255 - w * (255 - v)).rounded())
  }
}

/// A thin frame that's always white: no document prints in the outer 0.8%, and phone photos leave crumbs there
func whiteFrame(_ g: inout Gray) {
  let m = max(2, min(g.w, g.h) * 8 / 1000)
  for y in 0..<g.h {
    for x in 0..<g.w where y < m || y >= g.h - m || x < m || x >= g.w - m { g.px[y * g.w + x] = 255 }
  }
}

/// Pure black and white at the Otsu threshold
func binarize(_ g: inout Gray) {
  var hist = [Double](repeating: 0, count: 256)
  for p in g.px { hist[Int(p)] += 1 }
  let total = Double(g.px.count)
  let sumAll = hist.enumerated().reduce(0) { $0 + Double($1.offset) * $1.element }
  var wB = 0.0, sumB = 0.0, best = 0.0, threshold = 160
  for t in 0..<256 {
    wB += hist[t]
    if wB == 0 { continue }
    let wF = total - wB
    if wF == 0 { break }
    sumB += Double(t) * hist[t]
    let mB = sumB / wB, mF = (sumAll - sumB) / wF
    let between = wB * wF * (mB - mF) * (mB - mF)
    if between > best { best = between; threshold = t }
  }
  for i in 0..<g.px.count { g.px[i] = g.px[i] > UInt8(threshold) ? 255 : 0 }
}

func grayImage(_ g: Gray) -> CGImage {
  let data = Data(g.px) as CFData
  return CGImage(width: g.w, height: g.h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: g.w, space: graySpace,
                 bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                 provider: CGDataProvider(data: data)!, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
}

/// JPEG-backed image so the PDF stores the JPEG bytes as they are (DCT), not a huge re-encode
func jpegImage(_ image: CGImage, quality: Double) -> CGImage {
  let data = NSMutableData()
  let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  CGImageDestinationFinalize(dest)
  return CGImage(jpegDataProviderSource: CGDataProvider(data: data)!, decode: nil, shouldInterpolate: true,
                 intent: .defaultIntent)!
}

// MARK: Text

struct Line {
  var text: String
  var box: CGRect  // normalized, origin bottom-left
}

func lines(_ obs: [VNRecognizedTextObservation]) -> [Line] {
  obs.compactMap { o in o.topCandidates(1).first.map { Line(text: $0.string, box: o.boundingBox) } }
}

/// Reading-order text: pieces that share a row are joined left to right, so "Grand Total:  $1,567.10" stays together
func readingText(_ ls: [Line]) -> String {
  let sorted = ls.sorted { $0.box.midY > $1.box.midY }
  var rows: [[Line]] = []
  for l in sorted {
    if let last = rows.last?.first {
      let overlap = min(last.box.maxY, l.box.maxY) - max(last.box.minY, l.box.minY)
      if overlap > 0.5 * min(last.box.height, l.box.height) {
        rows[rows.count - 1].append(l)
        continue
      }
    }
    rows.append([l])
  }
  return rows.map { $0.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: "   ") }.joined(separator: "\n")
}

func words(_ s: String) -> Set<String> {
  Set(s.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init).filter { $0.count >= 3 })
}

// MARK: Pages

struct Page {
  var number: Int
  var image: CGImage  // final, as stored in the PDF
  var pointSize: CGSize
  var lines: [Line]
  var text: String
  var cropped: Bool
  var trimmed: Double
  var turned: Int
  var tilt: Double
  var letter: Bool
  var ink: Double
}

let debugging = ProcessInfo.processInfo.environment["DOC_CLEAN_DEBUG"] != nil
var lastMark = Date()
func mark(_ what: String) {
  guard debugging else { return }
  FileHandle.standardError.write(String(format: "%6.2fs  %@\n", Date().timeIntervalSince(lastMark), what).data(using: .utf8)!)
  lastMark = Date()
}

func process(_ source: CGImage, number: Int, o: Options) -> Page {
  var image = CIImage(cgImage: source)
  var cropped = false
  if o.crop, let sheet = findSheet(source) {
    image = straighten(image, sheet)
    cropped = true
  }
  mark("page \(number): sheet \(cropped)")
  let turn = (orientation(image) + (o.extraRotation[number] ?? 0)) % 360
  image = rotate(image, clockwise: turn)
  image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
  mark("page \(number): turned \(turn)")
  let tilt = textTilt(image)
  var appliedTilt = 0.0
  if abs(tilt) >= 0.2 {
    image = deskew(image, degrees: tilt)
    appliedTilt = tilt
  }
  mark("page \(number): tilt \(tilt)")

  // Size: a Letter-shaped sheet becomes exactly Letter; anything else keeps its shape at the same scale
  let w = image.extent.width, h = image.extent.height
  let ratio = max(w, h) / min(w, h)
  let letter = ratio > 1.2 && ratio < 1.42
  var pw: Int, ph: Int
  if letter {
    pw = Int(8.5 * o.dpi); ph = Int(11 * o.dpi)
    if w > h { swap(&pw, &ph) }
  } else {
    let s = min(1, 11 * o.dpi / Double(max(w, h)))
    pw = Int(Double(w) * s); ph = Int(Double(h) * s)
  }

  var final: CGImage
  var trimmed = 0.0
  if o.mode == "color" {
    final = render(image.transformed(by: CGAffineTransform(scaleX: Double(pw) / w, y: Double(ph) / h)))
  } else {
    var g = toGray(image, width: pw, height: ph)
    flatten(&g)
    clearHaze(&g)
    if o.crop {
      let mask = edgeMask(image, width: pw, height: ph)
      var n = 0
      for i in 0..<mask.count where mask[i] { g.px[i] = 255; n += 1 }
      trimmed = Double(n) / Double(mask.count)
      whiteFrame(&g)
    }
    if o.mode == "bw" { binarize(&g) }
    final = grayImage(g)
  }
  mark("page \(number): toned, \(Int(trimmed * 1000) / 10)% edge whitened")
  let ink = Double(toGrayCount(final)) / Double(pw * ph)
  let ls = lines(textObservations(final, accurate: true))
  mark("page \(number): OCR \(ls.count) lines")
  let size = CGSize(width: Double(pw) / o.dpi * 72, height: Double(ph) / o.dpi * 72)
  let stored = o.mode == "bw" ? final : jpegImage(final, quality: o.quality)
  return Page(number: number, image: stored, pointSize: size, lines: ls, text: readingText(ls), cropped: cropped,
              trimmed: trimmed, turned: turn, tilt: appliedTilt, letter: letter, ink: ink)
}

/// Dark pixels, for spotting blank pages
func toGrayCount(_ image: CGImage) -> Int {
  let w = image.width, h = image.height
  var px = [UInt8](repeating: 255, count: w * h)
  guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: graySpace,
                            bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  return px.reduce(0) { $0 + ($1 < 128 ? 1 : 0) }
}

// MARK: PDF

/// One font for every line, sized through the text matrix: a font per size would embed a subset per line
let ocrFont = CTFontCreateWithName("Helvetica" as CFString, 10, nil)

func drawInvisibleText(_ ctx: CGContext, _ ls: [Line], _ size: CGSize) {
  ctx.saveGState()
  ctx.setTextDrawingMode(.invisible)
  for l in ls {
    let r = CGRect(x: l.box.minX * size.width, y: l.box.minY * size.height,
                   width: l.box.width * size.width, height: l.box.height * size.height)
    guard r.width > 1, r.height > 1 else { continue }
    let str = NSAttributedString(string: l.text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): ocrFont])
    let line = CTLineCreateWithAttributedString(str)
    let width = CTLineGetTypographicBounds(line, nil, nil, nil)
    guard width > 0 else { continue }
    let sy = r.height * 0.85 / 10
    ctx.textMatrix = CGAffineTransform(scaleX: r.width / width, y: sy)
    ctx.textPosition = CGPoint(x: r.minX, y: r.minY + r.height * 0.18)
    CTLineDraw(line, ctx)
  }
  ctx.restoreGState()
}

func writePDF(_ pages: [Page], to url: URL, title: String) {
  var box = CGRect(origin: .zero, size: pages.first?.pointSize ?? CGSize(width: 612, height: 792))
  let info: [CFString: Any] = [kCGPDFContextCreator: "Financial Insider doc-clean", kCGPDFContextTitle: title]
  guard let ctx = CGContext(url as CFURL, mediaBox: &box, info as CFDictionary) else { fail("Can't write \(url.path)") }
  for p in pages {
    var media = CGRect(origin: .zero, size: p.pointSize)
    let pageInfo = [kCGPDFContextMediaBox: Data(bytes: &media, count: MemoryLayout<CGRect>.size)] as CFDictionary
    ctx.beginPDFPage(pageInfo)
    ctx.interpolationQuality = .high
    ctx.draw(p.image, in: media)
    drawInvisibleText(ctx, p.lines, p.pointSize)
    ctx.endPDFPage()
  }
  ctx.closePDF()
}

// MARK: Main

func emit(_ out: [String: Any]) -> Never {
  let json = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(json)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)
}

let o = parseOptions()
let started = Date()

// Born-digital PDF: most pages have a real text layer, so there's nothing to clean
if !o.force, o.input.lowercased().hasSuffix(".pdf"), let doc = PDFDocument(url: URL(fileURLWithPath: o.input)), doc.pageCount > 0 {
  let texts = (0..<doc.pageCount).map { doc.page(at: $0)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
  if texts.filter({ $0.count >= 40 }).count * 2 >= texts.count {
    emit(["input": o.input, "digital": true, "parts": [],
          "pages": texts.enumerated().map { ["page": $0.offset + 1, "chars": $0.element.count, "text": $0.element] }])
  }
}
let sources = loadPages(o.input)
mark("loaded \(sources.count) pages")
if sources.isEmpty { fail("No pages in \(o.input)") }
let pages = sources.enumerated().map { process($0.element, number: $0.offset + 1, o: o) }

let groups = (o.groups ?? [Array(1...pages.count)]).map { $0.filter { $0 >= 1 && $0 <= pages.count } }.filter { !$0.isEmpty }
if groups.isEmpty { fail("--pages left no pages") }
try? FileManager.default.createDirectory(atPath: o.outDir, withIntermediateDirectories: true)

var parts: [[String: Any]] = []
for (i, group) in groups.enumerated() {
  let file = groups.count == 1 ? "\(o.name).pdf" : "\(o.name) (\(i + 1) of \(groups.count)).pdf"
  let url = URL(fileURLWithPath: o.outDir).appendingPathComponent(file)
  writePDF(group.map { pages[$0 - 1] }, to: url, title: o.name)
  let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
  parts.append(["file": url.path, "pages": group, "bytes": bytes,
                "text": group.map { pages[$0 - 1].text }.joined(separator: "\n\n")])
}

// Pages that read nearly the same (a retake, or the same sheet with something lying on it)
let wordSets = pages.map { words($0.text) }
var report: [[String: Any]] = []
for p in pages {
  var similar: [Int] = []
  for q in pages where q.number != p.number {
    let a = wordSets[p.number - 1], b = wordSets[q.number - 1]
    let union = a.union(b).count
    if union >= 20 && Double(a.intersection(b).count) / Double(union) >= 0.6 { similar.append(q.number) }
  }
  report.append([
    "page": p.number, "cropped": p.cropped, "edgeWhitened": (p.trimmed * 1000).rounded() / 1000, "turned": p.turned, "tilt": (p.tilt * 10).rounded() / 10,
    "letter": p.letter, "blank": p.ink < 0.002 && p.text.count < 10, "similarTo": similar,
    "chars": p.text.count, "text": p.text,
  ])
}
let inputBytes = (try? FileManager.default.attributesOfItem(atPath: o.input)[.size] as? Int) ?? 0
emit([
  "input": o.input, "inputBytes": inputBytes, "digital": false, "mode": o.mode, "seconds": (Date().timeIntervalSince(started) * 10).rounded() / 10,
  "pages": report, "parts": parts,
])
