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

import { SYMBOL_SIZE_PDF_PTS } from './stage.js';

// How far above the text's own top edge to center the placed symbol, in PDF
// points, so it reads as sitting ABOVE the label instead of overlapping it.
// Half the symbol's own footprint clears the symbol itself; a few extra
// points leaves a visible gap instead of the two touching edge-to-edge.
const PLACEMENT_GAP_PDF_PTS = SYMBOL_SIZE_PDF_PTS / 2 + 3;

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

// Where to drop the symbol for a matched text item: horizontally centered
// on the text, positioned just above its top edge.
//
// IMPORTANT: item.width/item.height are already lengths in the SAME
// coordinate space as item.transform's own translation (e, f) -- pdf.js
// computes them that way, and its own text-layer renderer treats them as
// plain scalars, only ever using the transform's linear part (a, b, c, d) to
// read off a ROTATION ANGLE and a font-size magnitude, never to re-scale
// width/height through the full matrix. An earlier version of this function
// got that wrong -- it ran width/height through the FULL combined matrix
// like a local pre-transform coordinate, which re-applied item.transform's
// own internal scale (e.g. the font's em-to-user-space factor) on top of a
// width that already had it baked in. On plans with a large internal scale
// factor (common in CAD/Revit exports) that put the symbol far off in the
// direction of the transform -- exactly the "placed far right and up from
// the text" bug. The fix: use the combined transform ONLY for the item's
// origin and its direction (as unit vectors), and scale width/height by the
// outer viewport's own scale alone (1x here, since getPageTextData always
// requests scale: 1), matching how pdf.js's own text layer does it.
function matchPlacement(item, combined, viewportTransform) {
  const [a, b, c, d, e, f] = combined;
  const viewportScale = Math.hypot(viewportTransform[0], viewportTransform[1]) || 1;

  const xLen = Math.hypot(a, b) || 1;
  const unitX = { x: a / xLen, y: b / xLen }; // output-space "reading direction" of the text
  const yLen = Math.hypot(c, d) || 1;
  const unitY = { x: c / yLen, y: d / yLen }; // output-space "up from baseline" direction

  const width = (item.width || 0) * viewportScale;
  // item.height isn't always populated by pdf.js depending on the font/PDF;
  // Math.hypot(item.transform[2], item.transform[3]) is pdf.js's own
  // fallback for a glyph's em-height in this same pre-viewport-scale space.
  const height = (item.height || Math.hypot(item.transform[2], item.transform[3]) || 10) * viewportScale;

  const originX = e;
  const originY = f;
  const halfWidth = width / 2;
  const topOffset = height + PLACEMENT_GAP_PDF_PTS;

  return {
    x: originX + unitX.x * halfWidth + unitY.x * topOffset,
    y: originY + unitX.y * halfWidth + unitY.y * topOffset,
  };
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
    // Guard the type explicitly, not just truthiness -- pdfViewer.js's
    // getPageTextData() already filters these out, but findTextMatches is
    // cheap to make self-defensive too rather than trusting every caller to
    // pre-filter. A non-string truthy `str` (seen on some real-world
    // CAD-exported PDFs) would otherwise reach str.trim() below and throw
    // "undefined is not a function" (str.trim doesn't exist on it),
    // uncaught by the try/catch further down -- which only wraps
    // combineTransforms/matchPlacement -- killing matches for the ENTIRE
    // page instead of just skipping this one malformed item.
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str.trim()) continue;
    if (!str.toLowerCase().includes(q)) continue;
    // Some CAD-exported PDFs emit text-content items with a missing or
    // malformed `transform` (e.g. marked-content artifacts pdf.js still
    // surfaces as a TextItem). Skip a single bad item rather than letting
    // combineTransforms throw and kill matches for the entire page -- a
    // dropped item here just means one label doesn't get a symbol dropped
    // on it, which is far better than the whole search silently failing.
    if (!Array.isArray(item.transform) || item.transform.length !== 6) continue;
    try {
      const combined = combineTransforms(viewportTransform, item.transform);
      const placement = matchPlacement(item, combined, viewportTransform);
      if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) continue;
      matches.push({ x: placement.x, y: placement.y, text: str });
    } catch (err) {
      console.warn('Find & Place: skipping a malformed text item', str, err);
    }
  }
  return matches;
}
