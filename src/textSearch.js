// Finds occurrences of a word/tag within a PDF page's own embedded text
// layer -- the same real, vector text a CAD export (AutoCAD/Revit) already
// bakes into the PDF and that a normal PDF viewer lets you select/copy. This
// is NOT image-based OCR: it reads the text pdf.js already parses out of the
// page's content stream, which is faster and far more accurate than OCR
// whenever it's available. It simply does nothing useful on a scanned/
// flattened page that has no real text layer -- pdfViewer.js's
// getPageTextData() flags that case (hasText: false) so main.js can tell the
// user "no searchable text on this page" instead of silently finding zero
// matches and leaving them to wonder why.
//
// True image OCR (for scanned pages) and visual symbol/shape matching (for
// finding a repeated hand-drawn or CAD-block icon that isn't text at all)
// are bigger, separate builds -- deliberately out of scope here. See the
// findPlace status messaging in main.js for how a textless page surfaces
// that gap today.

// Combines two PDF/Canvas-style 2D affine matrices [a,b,c,d,e,f], where m2 is
// applied first and m1 second (matches pdf.js's own Util.transform(m1, m2)
// convention) -- used to place a text item's local glyph-space transform
// into the same page-viewport coordinate space (scale 1, top-left origin,
// y-down) that this app already stores every placed symbol's x/y in.
export function combineTransforms(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

// Centroid of a text item's glyph box under a given combined transform.
// Averaging all 4 corners (rather than just reading the transform's own
// translation, which is really the baseline start of the FIRST glyph) keeps
// this correct even for rotated text -- common in title blocks (e.g. a
// vertical "SHEET SIZE 24x36" label) -- since it doesn't assume the box is
// axis-aligned.
function itemCenter(item, combined) {
  const [a, b, c, d, e, f] = combined;
  const w = item.width || 0;
  // item.height isn't always populated by pdf.js depending on the font/PDF;
  // fall back to the transform's own vertical scale (glyph em size) as a
  // reasonable approximation when it's missing.
  const h = item.height || Math.hypot(b, d) || 10;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  let sx = 0;
  let sy = 0;
  for (const [lx, ly] of corners) {
    sx += a * lx + c * ly + e;
    sy += b * lx + d * ly + f;
  }
  return { x: sx / 4, y: sy / 4 };
}

// pageTextData: { items, viewportTransform } from PdfViewerSource.getPageTextData().
// query: plain substring, case-insensitive, matched against each individual
// text run pdf.js extracted. Short device tags/room numbers are almost
// always their own single run, so this covers the common case well; a
// search phrase split across multiple runs by the original CAD export (e.g.
// two words drawn as separate text objects) won't be found as one match --
// a known, documented limitation rather than a silent gap.
export function findTextMatches(pageTextData, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const { items, viewportTransform } = pageTextData;
  const matches = [];
  for (const item of items) {
    const str = item.str || '';
    if (!str.trim()) continue;
    if (!str.toLowerCase().includes(q)) continue;
    const combined = combineTransforms(viewportTransform, item.transform);
    const center = itemCenter(item, combined);
    matches.push({ x: center.x, y: center.y, text: str });
  }
  return matches;
}
