// Export: flatten placed symbols + a legend table onto the PDF (via pdf-lib),
// and a plain CSV export of the legend counts for takeoffs / material orders.
//
// `symbols`/`strokes` passed in here are always the WHOLE PROJECT's data
// (every page), each item tagged with a `page` number (1-based; missing/undefined
// means page 1, for projects saved before multi-page support existed) — never
// just the page currently on screen. Every page of the source PDF gets its own
// symbols/strokes flattened onto it, plus a small per-page legend box. Every
// export also gets one extra appended page with a full-size legend (combined
// project-wide totals plus a per-page breakdown once there's more than one
// page) — always, even for a single-page plan, since the small corner box
// alone isn't meant to stand in for a real legend page.
//
// A page with a /Rotate flag (very common on a real full-size architectural
// sheet -- it's often authored landscape but stored with a portrait
// MediaBox + Rotate 90/270 so it prints correctly) needs special handling
// here. symbol.x/y are stored in pdf.js's VIEWPORT space -- the same
// post-rotation, "as actually displayed" space used everywhere else in this
// app (Stage, textSearch.js, pictureSearch.js) -- but pdf-lib's own drawing
// coordinate system is the page's RAW, pre-rotation space, and pdf-lib does
// NOT automatically account for /Rotate the way pdf.js's viewport does. Left
// alone, that mismatch is exactly what scattered placed symbols across the
// page on export: this file was treating viewport-space coordinates as if
// they were already raw pdf-lib coordinates.
//
// The fix wraps everything drawn on a rotated page in a single `cm`
// (concatTransformationMatrix) operator equal to pdf.js's own inverse
// viewport transform (derived by sampling viewport.convertToPdfPoint rather
// than hand-deriving the matrix inverse -- that keeps this exactly in sync
// with whatever pdf.js itself does, including the sign/direction
// conventions, instead of a hand-rolled reimplementation that would be easy
// to get subtly wrong). Once that transform is pushed, every existing
// drawing call below -- symbols, strokes, the per-page legend box -- keeps
// working completely unchanged, because "pageWidth/pageHeight" simply
// becomes the viewport's (post-rotation) dimensions instead of the page's
// raw MediaBox dimensions. For an unrotated page this transform reduces to
// the same plain y-flip this file always used, so nothing changes there.

import { SYMBOLS_BY_ID } from './symbols.js';
import { computeLegend } from './legend.js';

const { PDFDocument, rgb, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = window.PDFLib;

const SYMBOL_SIZE_PDF_PTS = 16;
const ICON_RASTER_PX = 128;
const STROKE_WIDTH_PDF_PTS = 4; // must match the on-screen pencil width in stage.js
const STROKE_OPACITY = 0.55;
const STROKE_RENDER_SCALE = 4; // supersample factor so the exported line stays crisp

// Mirrors stage.js's traceSmoothPath() exactly (see that function's comment
// for why) so an exported PDF's stroke matches the on-screen one: curve
// through the midpoint of each pair of consecutive points, using the shared
// point as the quadratic control point, instead of connecting raw points
// with straight lines. Kept as a separate copy rather than a shared import
// since stage.js runs against screen-space points and export.js against a
// small offscreen canvas's local space — same math, different callers.
function traceSmoothPath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  let i;
  for (i = 1; i < pts.length - 2; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  ctx.quadraticCurveTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
}

function hexToRgbColor(hex) {
  const clean = (hex || '#ef4444').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function rasterizeSvgToPngBytes(svgString, px = ICON_RASTER_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, px, px);
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      resolve(bytes);
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString);
  });
}

// Renders one multi-point stroke to a small transparent PNG using a single
// canvas stroke() call — one continuous round-capped/round-joined path,
// same as the live on-screen rendering in stage.js's _renderStrokes(). This
// matters because the previous approach drew a circle at every vertex plus
// a separate line for every segment straight into the PDF, each as its own
// translucent object; everywhere they overlapped (every single vertex) the
// semi-transparent color stacked and compositied darker than the plain
// line in between, so a hand-drawn line came out looking like a string of
// beads instead of one continuous mark. Rendering the whole path as one
// coherent canvas fill sidesteps that entirely, and STROKE_OPACITY is then
// applied exactly once, to the finished bitmap, when it's placed on the page.
function strokeToPngBytes(stroke, pageHeight) {
  const toPdf = (p) => ({ x: p.x, y: pageHeight - p.y });
  const pdfPoints = stroke.points.map(toPdf);
  const pad = STROKE_WIDTH_PDF_PTS; // room for the line's own width + rounding
  const xs = pdfPoints.map((p) => p.x);
  const ys = pdfPoints.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const widthPts = Math.max(maxX - minX, 1);
  const heightPts = Math.max(maxY - minY, 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthPts * STROKE_RENDER_SCALE);
  canvas.height = Math.ceil(heightPts * STROKE_RENDER_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = STROKE_WIDTH_PDF_PTS * STROKE_RENDER_SCALE;

  // Local canvas space is y-down pixels; the PDF space computed above is
  // y-up. Map so the top row of the canvas corresponds to the bounding
  // box's highest PDF y, which is what keeps the shape right-side-up once
  // it's placed back on the page with drawImage below.
  const toLocal = (p) => ({
    x: (p.x - minX) * STROKE_RENDER_SCALE,
    y: (maxY - p.y) * STROKE_RENDER_SCALE,
  });

  ctx.beginPath();
  traceSmoothPath(ctx, pdfPoints.map(toLocal));
  ctx.stroke();

  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return { bytes, x: minX, y: minY, width: widthPts, height: heightPts };
}

// Draws one symbol image using its own raw-space corners, computed by
// mapping three points in VIEWPORT space (the icon's own bottom-left,
// bottom-right, and top-left corners, AS ACTUALLY ROTATED ON SCREEN) through
// `toRaw` one point at a time, instead of relying on pdf-lib's own `rotate:`
// parameter to rotate the whole image. This function must be called OUTSIDE
// any active pushed `cm` graphics state (see the per-page loop below) since
// `toRaw` already returns final raw-space coordinates -- an active `cm`
// would transform them a second time.
//
// The three corners are rotated using the EXACT same formula stage.js's
// on-screen rendering uses (ctx.rotate() in _renderOverlay -- a standard
// rotation matrix applied directly to y-down screen-pixel offsets, which is
// what makes ctx.rotate(θ) look clockwise for positive θ). Matching that
// formula here -- rather than reusing pdf-lib's own `rotate:` parameter,
// which turned out to need the OPPOSITE sign because pdf-lib draws into the
// page's native y-up space, a reflection of screen space -- is what makes
// an exported symbol's rotation direction match what's on screen. (An
// earlier version of this function reused pdf-lib's rotate: parameter
// directly and was calibrated against this file's old anchor formula, which
// -- it turns out -- had this same sign bug even on an unrotated page; it
// only ever got tested at rotation 0, where the sign of this bug has no
// effect.) Deriving the raw corners geometrically via `toRaw` and computing
// pdf-lib's `rotate:` value from THEM (via atan2) sidesteps needing pdf-lib's
// rotate convention to line up with anything -- it's whatever the geometry
// says it should be.
function drawSymbolDirect(page, image, toRaw, cx, cy, w, h, angleDeg) {
  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = w / 2;
  const hh = h / 2;
  // Rotates an unrotated local offset (y-down, origin at the icon's center)
  // by angleDeg clockwise -- identical to what ctx.rotate(theta) does to a
  // point in stage.js's on-screen rendering.
  const rotateCw = (lx, ly) => ({ x: lx * cos - ly * sin, y: lx * sin + ly * cos });
  const bl = rotateCw(-hw, hh); // bottom-left: pdf-lib's own drawImage anchor corner
  const br = rotateCw(hw, hh); // bottom-right: anchor's local +width direction
  const tl = rotateCw(-hw, -hh); // top-left: anchor's local +height direction
  const p0 = toRaw(cx + bl.x, cy + bl.y);
  const pX = toRaw(cx + br.x, cy + br.y);
  const pY = toRaw(cx + tl.x, cy + tl.y);
  const edgeX = { x: pX[0] - p0[0], y: pX[1] - p0[1] };
  const edgeY = { x: pY[0] - p0[0], y: pY[1] - p0[1] };
  const rotateDeg = (Math.atan2(edgeX.y, edgeX.x) * 180) / Math.PI;
  page.drawImage(image, {
    x: p0[0],
    y: p0[1],
    width: Math.hypot(edgeX.x, edgeX.y),
    height: Math.hypot(edgeY.x, edgeY.y),
    rotate: degrees(rotateDeg),
  });
}

// Small legend box, bottom-right corner of a single sheet — same box the
// original single-page export drew, just parameterized so it can show either
// "this sheet's counts" (label passed in) on every page.
function drawLegendBox(page, pageWidth, pageHeight, symbols, font, fontBold, title) {
  const { rows, total } = computeLegend(symbols);
  const rowH = 14;
  const padding = 8;
  const tableW = 190;
  const tableH = 24 + rowH * Math.max(rows.length, 1) + padding * 2;
  const boxX = pageWidth - tableW - 18;
  const boxY = 18;

  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: tableW,
    height: tableH,
    color: rgb(1, 1, 1),
    opacity: 0.92,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 1,
  });
  page.drawText(title, {
    x: boxX + padding,
    y: boxY + tableH - padding - 10,
    size: 9,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  let ty = boxY + tableH - padding - 24;
  if (rows.length === 0) {
    page.drawText('No symbols on this page', { x: boxX + padding, y: ty, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  }
  for (const row of rows) {
    page.drawText(row.def.abbr, { x: boxX + padding, y: ty, size: 8, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(row.def.name, { x: boxX + padding + 42, y: ty, size: 8, font, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(String(row.count), {
      x: boxX + tableW - padding - 14,
      y: ty,
      size: 8,
      font: fontBold,
      color: rgb(0.15, 0.15, 0.15),
    });
    ty -= rowH;
  }
  page.drawText(`Total: ${total}`, {
    x: boxX + padding,
    y: boxY + padding - 2,
    size: 8,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
}

// A full-page summary appended after every real sheet in the export: the
// combined symbol counts, big and easy to read, plus (for a multi-page
// project) a per-page breakdown so a reviewer doesn't have to flip through
// every sheet's small corner box to see how the total was built up. Appended
// unconditionally -- including for a single-page plan -- since that corner
// box is easy to miss/hard to read at a glance and Tim's workflow expects a
// dedicated legend page at the end of every export, not just multi-page ones.
function drawProjectSummaryPage(page, width, height, allSymbols, numPages, projectName, font, fontBold) {
  const margin = 48;
  let ty = height - margin;

  page.drawText(numPages > 1 ? 'PROJECT SYMBOL LEGEND — ALL PAGES' : 'SYMBOL LEGEND', { x: margin, y: ty, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  ty -= 22;
  if (projectName) {
    page.drawText(projectName, { x: margin, y: ty, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
    ty -= 16;
  }
  if (numPages > 1) {
    page.drawText(`${numPages} pages`, { x: margin, y: ty, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    ty -= 30;
  } else {
    ty -= 14;
  }

  const { rows, total } = computeLegend(allSymbols);
  const colAbbr = margin;
  const colName = margin + 70;
  const colTotal = width - margin - 60;
  const rowH = 20;

  page.drawText('ABBR', { x: colAbbr, y: ty, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('SYMBOL', { x: colName, y: ty, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('TOTAL', { x: colTotal, y: ty, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
  ty -= 8;
  page.drawLine({ start: { x: margin, y: ty }, end: { x: width - margin, y: ty }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  ty -= rowH;

  for (const row of rows) {
    page.drawText(row.def.abbr, { x: colAbbr, y: ty, size: 10, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(row.def.name, { x: colName, y: ty, size: 10, font, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(String(row.count), { x: colTotal, y: ty, size: 10, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    ty -= rowH;
  }

  ty -= 6;
  page.drawLine({ start: { x: margin, y: ty }, end: { x: width - margin, y: ty }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  ty -= rowH;
  page.drawText(`${numPages > 1 ? 'PROJECT TOTAL' : 'TOTAL'}: ${total}`, { x: margin, y: ty, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

  // The per-page breakdown only adds anything beyond the totals table above
  // when there's more than one page to break down.
  if (numPages > 1) {
    ty -= 34;
    page.drawText('Per-page breakdown', { x: margin, y: ty, size: 11, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
    ty -= 18;
    for (let p = 1; p <= numPages; p++) {
      const pageSymbols = allSymbols.filter((s) => (s.page || 1) === p);
      if (pageSymbols.length === 0) continue;
      const { rows: pRows } = computeLegend(pageSymbols);
      const summary = pRows.map((r) => `${r.def.abbr} x${r.count}`).join('   ');
      page.drawText(`Page ${p}: ${pageSymbols.length} total — ${summary}`, {
        x: margin,
        y: ty,
        size: 9,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });
      ty -= 14;
      if (ty < margin) break; // simple guard against overflowing a very long project — not expected in practice
    }
  }
}

// Computes the `cm` matrix that maps a "local" y-up coordinate system sized
// to the page's pdf.js VIEWPORT (post-rotation) dimensions into the page's
// raw pdf-lib drawing space -- see the file header comment for why this is
// needed. Sampled from pdf.js's own viewport.convertToPdfPoint() at three
// points (origin + one unit along each local axis) rather than hand-derived,
// so this always matches whatever pdf.js itself does for this page's
// rotation, including which axis flips/swaps -- there's no case-by-case
// 0/90/180/270 logic to get wrong here.
function localToRawMatrix(viewport) {
  // convertToPdfPoint expects pdf.js's own (y-down) viewport space; flipping
  // y here first is what makes "local" a y-up space of the same dimensions,
  // matching the space every draw call below already assumes.
  const toRaw = (x, y) => viewport.convertToPdfPoint(x, viewport.height - y);
  const p0 = toRaw(0, 0);
  const pX = toRaw(1, 0);
  const pY = toRaw(0, 1);
  return [pX[0] - p0[0], pX[1] - p0[1], pY[0] - p0[0], pY[1] - p0[1], p0[0], p0[1]];
}

export async function exportAnnotatedPdf({ pdfBytes, symbols, strokes, projectName, pdfJsDoc }) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const numPages = pages.length;

  // Embed one PNG per symbol type used anywhere in the project (not just one
  // page) so it can be reused across every sheet it appears on.
  const usedDefIds = [...new Set((symbols || []).map((s) => s.defId))];
  const embedded = new Map();
  for (const defId of usedDefIds) {
    const def = SYMBOLS_BY_ID[defId];
    if (!def) continue;
    const pngBytes = await rasterizeSvgToPngBytes(def.svg);
    const img = await pdfDoc.embedPng(pngBytes);
    embedded.set(defId, img);
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const page = pages[i];

    // pageWidth/pageHeight below is deliberately the pdf.js VIEWPORT size
    // (post-rotation, "as actually displayed") whenever pdf.js is available,
    // not pdf-lib's raw page.getSize() -- see the file header comment.
    // `toRaw` maps a VIEWPORT-space point directly to its exact raw pdf-lib
    // point, one point at a time -- symbols use this (see drawSymbolDirect
    // above for why). Strokes and the legend box instead draw inside a
    // single pushed `cm` transform equal to this same mapping (see
    // localToRawMatrix below) since neither of them needs pdf-lib's own
    // `rotate:` parameter, so pushing one transform and leaving their
    // existing (pre-rotation-support) drawing code completely unchanged is
    // simpler than converting them to point-by-point mapping too.
    let pageWidth, pageHeight, toRaw, viewport;
    if (pdfJsDoc) {
      const pjsPage = await pdfJsDoc.getPage(pageNum);
      viewport = pjsPage.getViewport({ scale: 1 });
      pageWidth = viewport.width;
      pageHeight = viewport.height;
      toRaw = (vx, vy) => viewport.convertToPdfPoint(vx, vy);
    } else {
      // No pdf.js document passed in -- fall back to the page's own raw
      // size and a plain y-flip. Only correct for an unrotated page, same as
      // this function's behavior before rotation support existed.
      const size = page.getSize();
      pageWidth = size.width;
      pageHeight = size.height;
      toRaw = (vx, vy) => [vx, pageHeight - vy];
    }

    const pageSymbols = (symbols || []).filter((s) => (s.page || 1) === pageNum);
    const pageStrokes = (strokes || []).filter((s) => (s.page || 1) === pageNum);

    // Draw each placed symbol directly in raw space via drawSymbolDirect,
    // deliberately BEFORE the `cm` pushed below -- toRaw already returns
    // final raw coordinates, so an active `cm` at this point would
    // transform them a second time (see drawSymbolDirect's comment).
    for (const s of pageSymbols) {
      const img = embedded.get(s.defId);
      if (!img) continue;
      drawSymbolDirect(page, img, toRaw, s.x, s.y, SYMBOL_SIZE_PDF_PTS, SYMBOL_SIZE_PDF_PTS, s.rotation || 0);
    }

    // Strokes and the legend box draw inside a single pushed `cm` transform
    // (an identity transform on an unrotated page, so nothing changes
    // there) so their existing, already-correct drawing code can stay
    // exactly as it was before rotation support existed.
    let wrappedTransform = false;
    if (pdfJsDoc) {
      const m = localToRawMatrix(viewport);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
      wrappedTransform = true;
    }

    // Freeform pencil markup, on top of the symbols (same convention as
    // on-screen). Same viewport-space -> PDF-space y-flip as before. A
    // 1-point stroke (a tap with no drag) is just a single dot, drawn
    // directly — no overlap possible, so no reason to route it through a
    // canvas. Multi-point strokes go through strokeToPngBytes() so the
    // whole line renders as one continuous shape (see that function's
    // comment for why drawing per-vertex circles + per-segment lines
    // straight into the PDF made lines look like a string of beads).
    for (const stroke of pageStrokes) {
      if (!stroke.points || stroke.points.length === 0) continue;
      if (stroke.points.length === 1) {
        const color = hexToRgbColor(stroke.color);
        const p = { x: stroke.points[0].x, y: pageHeight - stroke.points[0].y };
        page.drawCircle({ x: p.x, y: p.y, size: STROKE_WIDTH_PDF_PTS / 2, color, opacity: STROKE_OPACITY });
        continue;
      }
      const rendered = strokeToPngBytes(stroke, pageHeight);
      const strokeImg = await pdfDoc.embedPng(rendered.bytes);
      page.drawImage(strokeImg, {
        x: rendered.x,
        y: rendered.y,
        width: rendered.width,
        height: rendered.height,
        opacity: STROKE_OPACITY,
      });
    }

    drawLegendBox(page, pageWidth, pageHeight, pageSymbols, font, fontBold, numPages > 1 ? `PAGE ${pageNum} LEGEND` : 'SYMBOL LEGEND');

    if (wrappedTransform) {
      page.pushOperators(popGraphicsState());
    }
  }

  // Always append one full-page legend summary at the end, even for a
  // single-page plan — the small per-sheet corner box is easy to miss/hard
  // to read at a glance, and this is meant to be a real "legend page"
  // deliverable every export includes, not just an aid for multi-page
  // projects.
  {
    const { width, height } = pages[0].getSize();
    const summaryPage = pdfDoc.addPage([width, height]);
    drawProjectSummaryPage(summaryPage, width, height, symbols || [], numPages, projectName, font, fontBold);
  }

  if (projectName) {
    pdfDoc.setTitle(projectName);
  }

  return pdfDoc.save();
}

export function legendToCsv(symbols, opts = {}) {
  const numPages = opts.numPages || 1;
  const lines = [];

  if (numPages > 1) {
    for (let p = 1; p <= numPages; p++) {
      const pageSymbols = symbols.filter((s) => (s.page || 1) === p);
      lines.push(`Page ${p}`);
      lines.push('Abbreviation,Symbol,Category,Count');
      const { rows } = computeLegend(pageSymbols);
      for (const row of rows) {
        lines.push(`${csvEscape(row.def.abbr)},${csvEscape(row.def.name)},${csvEscape(row.def.category)},${row.count}`);
      }
      lines.push(`,,Page ${p} Total,${pageSymbols.length}`);
      lines.push('');
    }
    lines.push('All Pages');
  }

  lines.push('Abbreviation,Symbol,Category,Count');
  const { rows, total } = computeLegend(symbols);
  for (const row of rows) {
    lines.push(`${csvEscape(row.def.abbr)},${csvEscape(row.def.name)},${csvEscape(row.def.category)},${row.count}`);
  }
  lines.push(`,,${numPages > 1 ? 'Project Total' : 'Total'},${total}`);
  return lines.join('\n');
}

function csvEscape(v) {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function downloadBlob(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
