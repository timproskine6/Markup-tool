// Finds occurrences of a hand-drawn or CAD-block symbol by comparing pixels,
// not text -- for repeated icons on a plan that were never real selectable
// text in the first place (an existing furniture block, a legacy fire-alarm
// symbol from before this app existed, anything drawn as vector/raster
// artwork rather than a text run). Companion to textSearch.js: that one
// reads the PDF's real text layer; this one reads the PDF's rendered pixels.
//
// No external library involved -- unlike the OCR idea explored earlier in
// this project (which needed a large third-party model this sandbox has no
// network access to fetch), template matching on simple black/red line-art
// is small enough to write by hand against the Canvas 2D API this app
// already uses everywhere else.
//
// How it works, in order:
//  1. captureTemplate() renders just the small on-screen rectangle the user
//     dragged out, at whatever pixel scale a given search pass needs (see
//     below for why the scale isn't decided until search time).
//  2. findPictureMatches() renders the ENTIRE target page at a bounded
//     working resolution (same "cap the long side" idea pdfViewer.js already
//     uses for on-screen display, just a separate raster -- this one must
//     stay stable across a whole search even if the user pans/zooms the live
//     view mid-search). The template is (re-)rendered at that SAME scale, so
//     every pixel in the template lines up 1-for-1 with a pixel in the page
//     scan -- no resampling/interpolation mismatch between the two.
//  3. Both rasters are reduced to a simple binary "ink vs. paper" mask
//     (anything darker than near-white counts as ink) -- these are line-art
//     symbols on a white background, not photos, so a hard black/white
//     threshold is both simpler and more robust than trying to match exact
//     colors or grayscale shades.
//  4. A coarse pass (heavily downsampled, block-averaged) scans the WHOLE
//     page cheaply to shortlist candidate positions, then each candidate is
//     refined against the full-resolution masks in a small neighborhood.
//     Scanning a multi-thousand-point architectural sheet pixel-by-pixel at
//     full resolution for every possible template position would be far too
//     slow for an iPad; coarse-then-refine keeps the same accuracy at a
//     fraction of the cost.
//  5. Nearby candidates are merged (non-max suppression) so one real symbol
//     doesn't get reported -- and placed -- more than once.

import { SYMBOL_SIZE_PDF_PTS } from './stage.js';

const PLACEMENT_GAP_PDF_PTS = SYMBOL_SIZE_PDF_PTS / 2 + 3; // same "small visible gap above" convention as textSearch.js
const MAX_SCAN_PIXELS = 1900; // floor for the whole-page scan raster's long side on a small/medium sheet -- same "protect the device" spirit as pdfViewer.js's MAX_INITIAL_PIXELS
const TEMPLATE_TARGET_PX = 64; // the snipped template's SHORTER side should render at least this many pixels, or its own fine detail (a thin prong, a small letter) gets lost before matching even starts
const MAX_SCAN_MEGAPIXELS = 16; // hard ceiling on the whole-page raster regardless of template size -- keeps a huge full-size architectural sheet (a real 30x42in E-size plot is common) from blowing up memory/CPU on an iPad
const INK_LUMINANCE_THRESHOLD = 210; // below this (out of 255) counts as "ink", matches non-white/near-white paper
const COARSE_DOWNSAMPLE = 4; // block-average factor for the cheap first pass
const COARSE_SCORE_MIN = 0.58; // lenient -- just enough to shortlist candidates for the expensive refine step (Dice-coefficient scale, see windowScore)
const FINAL_SCORE_MIN = 0.83; // strict -- what actually counts as "found" after refining at full resolution
const MIN_TEMPLATE_PX = 5; // guards against a near-zero-size accidental selection
const MIN_TEMPLATE_INK_FRACTION = 0.04; // a crop that's almost entirely blank paper is ambiguous -- it'll "match" nearly every other blank patch of the page equally well, which is a correctness problem (see buildIntegralImage below), not just a quality one
const MAX_COARSE_CANDIDATES = 4000; // defensive cap -- if a template is generic enough to shortlist more than this many spots, refining all of them would stall the page; bail out with a clear reason instead of hanging

// ---- rendering -------------------------------------------------------

// Renders a PDF-point rectangle (in this app's usual page-space, same as
// every placed symbol's x/y) at `scale` raster px per PDF point, using
// pdf.js's own offsetX/offsetY viewport option so only the requested crop is
// rendered -- not the whole page -- even though the crop itself may be tiny.
async function renderPdfRectToCanvas(pdfSource, pageNum, pdfRect, scale) {
  const page = await pdfSource.pdfDoc.getPage(pageNum);
  const pxW = Math.max(1, Math.round(pdfRect.w * scale));
  const pxH = Math.max(1, Math.round(pdfRect.h * scale));
  const viewport = page.getViewport({ scale, offsetX: -pdfRect.x * scale, offsetY: -pdfRect.y * scale });
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Renders the WHOLE page at a bounded resolution for the page-wide scan.
async function renderFullPageToCanvas(pdfSource, pageNum, scale) {
  const page = await pdfSource.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Picks a scan scale (raster px per PDF point). A flat "cap the page's long
// side" rule (the original approach here) works fine on a normal Letter/A-
// size reference sheet, but falls apart on a real full-size architectural
// plot -- Tim's own plans run up to 42x30in (3024x2160 PDF points). Capping
// the WHOLE PAGE to MAX_SCAN_PIXELS on a sheet that size works out to
// something like 45 DPI, at which point a small hand-drawn symbol (a few
// tenths of an inch of actual ink) blurs down into a nearly featureless
// blob -- indistinguishable from plenty of other unrelated marks on a busy
// sheet, which is exactly what produced a "too much of the page to search
// reliably" result on a symbol that was, by eye, perfectly distinctive.
//
// So scale is driven by the TEMPLATE first: whatever it takes to get the
// snipped crop's shorter side up to TEMPLATE_TARGET_PX of real detail. That
// scale is then clamped to MAX_SCAN_MEGAPIXELS worth of whole-page raster --
// still a real ceiling, so a huge sheet with a tiny snip doesn't try to
// allocate an unbounded canvas -- and finally clamped to the original
// MAX_SCAN_PIXELS-based floor and the existing "never upscale past 4px/pt"
// ceiling, so a normal-size reference sheet like a NOTIFICATION_DEVICES.pdf
// (Letter-size) renders exactly as before this fix.
function pickScanScale(pageWidthPt, pageHeightPt, templateWPt, templateHPt) {
  const longSide = Math.max(pageWidthPt, pageHeightPt);
  const floorScale = MAX_SCAN_PIXELS / longSide;
  const detailScale = templateWPt > 0 && templateHPt > 0
    ? TEMPLATE_TARGET_PX / Math.max(1, Math.min(templateWPt, templateHPt))
    : floorScale;
  const memoryBudgetScale = Math.sqrt((MAX_SCAN_MEGAPIXELS * 1e6) / Math.max(1, pageWidthPt * pageHeightPt));
  return Math.min(Math.max(detailScale, floorScale), memoryBudgetScale, 4); // never upscale past 4px/pt even on a small sheet -- plenty of detail, keeps memory bounded
}

function canvasToInkMask(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Alpha-aware: a transparent pixel (nothing rendered there) counts as
    // paper, not ink, same as a rendered white pixel would.
    const a = data[i + 3];
    if (a < 16) {
      mask[p] = 0;
      continue;
    }
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    mask[p] = luminance < INK_LUMINANCE_THRESHOLD ? 1 : 0;
  }
  return { mask, w, h };
}

// Block-mean downsample of a binary mask into a continuous ink-density grid
// (0..1 per cell) -- used only for the cheap coarse pass; the refine step
// re-checks candidates against the original full-resolution binary masks.
function downsampleDensity(mask, w, h, factor) {
  const dw = Math.max(1, Math.ceil(w / factor));
  const dh = Math.max(1, Math.ceil(h / factor));
  const out = new Float32Array(dw * dh);
  const counts = new Uint16Array(dw * dh);
  for (let y = 0; y < h; y++) {
    const dy = (y / factor) | 0;
    const rowBase = y * w;
    const outRowBase = dy * dw;
    for (let x = 0; x < w; x++) {
      const dx = (x / factor) | 0;
      out[outRowBase + dx] += mask[rowBase + x];
      counts[outRowBase + dx]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? out[i] / counts[i] : 0;
  return { grid: out, w: dw, h: dh };
}

// ---- rotation --------------------------------------------------------

function rotateMask90(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // (x, y) in the source -> (h-1-y, x) in a 90°-clockwise-rotated w<->h-swapped result
      out[x * h + (h - 1 - y)] = mask[y * w + x];
    }
  }
  return { mask: out, w: h, h: w };
}

function templateOrientations(mask, w, h, includeRotations) {
  const base = { mask, w, h, rotationDeg: 0 };
  if (!includeRotations) return [base];
  const r90 = rotateMask90(mask, w, h);
  const r180 = rotateMask90(r90.mask, r90.w, r90.h);
  const r270 = rotateMask90(r180.mask, r180.w, r180.h);
  return [
    base,
    { mask: r90.mask, w: r90.w, h: r90.h, rotationDeg: 90 },
    { mask: r180.mask, w: r180.w, h: r180.h, rotationDeg: 180 },
    { mask: r270.mask, w: r270.w, h: r270.h, rotationDeg: 270 },
  ];
}

// ---- matching ----------------------------------------------------------

// Dice-coefficient-style similarity between a template and a same-size
// window of a page grid starting at (ox, oy): 2x overlap / (template ink +
// window ink), 0 when neither has any ink there. Deliberately NOT a plain
// mean-absolute-difference over the whole window -- these symbols are
// mostly blank paper with a small amount of actual ink, and on a
// mostly-blank-vs-mostly-blank comparison, plain pixel agreement (including
// all the blank pixels that trivially "agree") scores misleadingly high
// regardless of whether the ink itself lines up. Scoring only the ink that's
// actually there fixes that -- two blank patches now correctly score 0
// instead of a false near-1.
function windowScore(pageGrid, pageW, tGrid, tw, th, ox, oy) {
  let intersection = 0;
  let tSum = 0;
  let wSum = 0;
  for (let y = 0; y < th; y++) {
    const pRow = (oy + y) * pageW + ox;
    const tRow = y * tw;
    for (let x = 0; x < tw; x++) {
      const tv = tGrid[tRow + x];
      const pv = pageGrid[pRow + x];
      intersection += Math.min(tv, pv);
      tSum += tv;
      wSum += pv;
    }
  }
  const denom = tSum + wSum;
  return denom < 1e-6 ? 0 : (2 * intersection) / denom;
}

// Summed-area table over a density grid, so "total ink in this candidate
// window" is an O(1) lookup instead of re-scanning the window. Used as a
// cheap pre-filter before the expensive full windowScore: a window whose
// total ink is way more or less than the template's own can't be a match,
// no matter what the per-pixel comparison would say. This matters more than
// it might sound like -- without it, a MOSTLY-BLANK template (a faint or
// oversimplified crop) scores deceptively well against every other blank
// patch of the page (blank matches blank everywhere), which is exactly what
// caused an early version of this search to hang scanning a real plan.
function buildIntegralImage(grid, w, h) {
  const satW = w + 1;
  const sat = new Float64Array(satW * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += grid[y * w + x];
      sat[(y + 1) * satW + (x + 1)] = sat[y * satW + (x + 1)] + rowSum;
    }
  }
  return { sat, satW };
}

function integralSum({ sat, satW }, x0, y0, x1, y1) {
  return sat[y1 * satW + x1] - sat[y0 * satW + x1] - sat[y1 * satW + x0] + sat[y0 * satW + x0];
}

function nonMaxSuppress(candidates, minDist) {
  const kept = [];
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  for (const c of sorted) {
    const tooClose = kept.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < minDist);
    if (!tooClose) kept.push(c);
  }
  return kept;
}

// Finds every occurrence of `template` (see captureTemplate) on `pageNum`.
// Returns { matches, reason }: matches is this app's usual page-space (PDF
// points, same space placed symbols already live in):
// [{ x, y, w, h, score, rotationDeg }]. `reason` is null on an ordinary run
// (including an ordinary zero-match run) and a short machine-readable string
// when the search was skipped outright because the template itself isn't
// usable -- callers turn that into an actual explanation for the user rather
// than a bare "no matches found" that doesn't say why.
export async function findPictureMatches(pdfSource, pageNum, template, options = {}) {
  const includeRotations = !!options.rotationTolerant;

  const page = await pdfSource.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scanScale = pickScanScale(viewport.width, viewport.height, template.pdfRect.w, template.pdfRect.h);

  const pageCanvas = await renderFullPageToCanvas(pdfSource, pageNum, scanScale);
  const { mask: pageMask, w: pageW, h: pageH } = canvasToInkMask(pageCanvas);

  // Re-render the template at THIS page's scan scale (not whatever scale it
  // was originally captured at) so template and page pixels line up exactly
  // -- matters most when "All pages" scope mixes pages of different sizes.
  const templateCanvas = await renderPdfRectToCanvas(pdfSource, template.sourcePage, template.pdfRect, scanScale);
  const { mask: baseTemplateMask, w: baseTw, h: baseTh } = canvasToInkMask(templateCanvas);
  if (baseTw < MIN_TEMPLATE_PX || baseTh < MIN_TEMPLATE_PX) return { matches: [], reason: 'too_small' };

  let templateInk = 0;
  for (let i = 0; i < baseTemplateMask.length; i++) templateInk += baseTemplateMask[i];
  if (templateInk / (baseTw * baseTh) < MIN_TEMPLATE_INK_FRACTION) return { matches: [], reason: 'too_faint' };

  const orientations = templateOrientations(baseTemplateMask, baseTw, baseTh, includeRotations);

  const pageDensity = downsampleDensity(pageMask, pageW, pageH, COARSE_DOWNSAMPLE);
  const pageIntegral = buildIntegralImage(pageDensity.grid, pageDensity.w, pageDensity.h);

  let allMatches = [];
  let tooManyCandidates = false;
  for (const orient of orientations) {
    const tDensity = downsampleDensity(orient.mask, orient.w, orient.h, COARSE_DOWNSAMPLE);
    if (tDensity.w >= pageDensity.w || tDensity.h >= pageDensity.h) continue; // template coarser than the whole page scan -- not a realistic symbol crop

    let tSum = 0;
    for (let i = 0; i < tDensity.grid.length; i++) tSum += tDensity.grid[i];
    // How far a candidate window's total ink may drift from the template's
    // own before it's not worth the expensive full comparison. A flat
    // fraction of tSum (with a small floor) rather than an absolute number,
    // since templates range from a tiny device tag to a large furniture
    // block. This is a PRE-filter only -- it can let extra candidates
    // through to the real scorer, but must never reject a true match.
    const sumTolerance = Math.max(tSum * 0.45, 0.6);

    // Coarse pass: integral-image sum check first (O(1) per candidate) --
    // only candidates that survive it pay for the full per-pixel windowScore.
    const coarseCandidates = [];
    const maxOx = pageDensity.w - tDensity.w;
    const maxOy = pageDensity.h - tDensity.h;
    for (let oy = 0; oy <= maxOy; oy++) {
      for (let ox = 0; ox <= maxOx; ox++) {
        const winSum = integralSum(pageIntegral, ox, oy, ox + tDensity.w, oy + tDensity.h);
        if (Math.abs(winSum - tSum) > sumTolerance) continue;
        const score = windowScore(pageDensity.grid, pageDensity.w, tDensity.grid, tDensity.w, tDensity.h, ox, oy);
        if (score >= COARSE_SCORE_MIN) coarseCandidates.push({ x: ox, y: oy, score });
      }
    }

    if (coarseCandidates.length > MAX_COARSE_CANDIDATES) {
      tooManyCandidates = true;
      continue; // this orientation is too ambiguous to search fully -- skip rather than stall the page; other orientations (if any) still get a chance
    }

    // Refine each shortlisted spot against the full-resolution masks in a
    // small neighborhood around the coarse position.
    const refined = [];
    for (const cand of coarseCandidates) {
      const centerX = cand.x * COARSE_DOWNSAMPLE;
      const centerY = cand.y * COARSE_DOWNSAMPLE;
      let best = null;
      for (let dy = -COARSE_DOWNSAMPLE; dy <= COARSE_DOWNSAMPLE; dy++) {
        const oy = centerY + dy;
        if (oy < 0 || oy + orient.h > pageH) continue;
        for (let dx = -COARSE_DOWNSAMPLE; dx <= COARSE_DOWNSAMPLE; dx++) {
          const ox = centerX + dx;
          if (ox < 0 || ox + orient.w > pageW) continue;
          const score = windowScore(pageMask, pageW, orient.mask, orient.w, orient.h, ox, oy);
          if (!best || score > best.score) best = { x: ox, y: oy, score };
        }
      }
      if (best && best.score >= FINAL_SCORE_MIN) {
        refined.push({ x: best.x, y: best.y, w: orient.w, h: orient.h, score: best.score, rotationDeg: orient.rotationDeg });
      }
    }
    allMatches = allMatches.concat(refined);
  }

  const minDist = Math.min(baseTw, baseTh) * 0.6;
  const deduped = nonMaxSuppress(allMatches, minDist);

  // Back to PDF points -- pixel (0,0) of this scan render IS PDF point (0,0)
  // at scale 1, since renderFullPageToCanvas uses a plain (unshifted, scale-
  // only) viewport, same convention every other placed symbol's x/y uses.
  const matches = deduped.map((m) => ({
    x: m.x / scanScale,
    y: m.y / scanScale,
    w: m.w / scanScale,
    h: m.h / scanScale,
    score: m.score,
    rotationDeg: m.rotationDeg,
  }));
  return { matches, reason: matches.length === 0 && tooManyCandidates ? 'too_ambiguous' : null };
}

// Captures a small preview raster of a user-selected rectangle, purely for
// showing them what they snipped -- the actual search re-renders this same
// pdfRect fresh at whatever scale each page scan needs (see
// findPictureMatches above), so this preview's own resolution doesn't need
// to match anything else.
export async function captureTemplatePreview(pdfSource, pageNum, pdfRect) {
  const PREVIEW_SCALE = 6; // generous fixed px/pt just for a crisp on-screen thumbnail
  const canvas = await renderPdfRectToCanvas(pdfSource, pageNum, pdfRect, PREVIEW_SCALE);
  return canvas.toDataURL('image/png');
}

// Where to drop the armed symbol for a found match: horizontally centered on
// the match, a small gap above its top edge -- same "sit clear above, not
// centered on top of" convention textSearch.js uses for text matches.
export function placementForMatch(match) {
  return {
    x: match.x + match.w / 2,
    y: match.y - PLACEMENT_GAP_PDF_PTS,
  };
}
