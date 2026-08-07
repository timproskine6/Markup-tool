// The markup "stage": a PDF raster canvas plus a transparent overlay canvas
// on top of it (standing in for the two-canvas Konva.js layering described
// in the build plan). Owns pan/zoom, tap-to-place, drag, rotate, delete, and
// stamp mode. Placed-symbol positions are stored in PDF point space so they
// survive zoom/pan/rotation of the device.

import { getSymbolImage, SYMBOLS_BY_ID } from './symbols.js';

export const SYMBOL_SIZE_PDF_PTS = 16; // symbol footprint in PDF points -> scales with the plan; exported so textSearch.js can offset a Find & Place match to sit clear above a text label instead of centered on top of it
const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const TAP_MOVE_THRESHOLD = 6; // px — under this, a pointer down+up counts as a tap not a drag
const HANDLE_MARGIN_PX = 8; // how far outside the icon's footprint the corner handles sit
const HANDLE_MIN_HALF_PX = 10; // keeps handles reachable even when zoomed way out
const HANDLE_VISUAL_RADIUS_PX = 6;
const HANDLE_HIT_RADIUS_PX = 16; // generous touch target, bigger than the visible dot
const ROTATE_HANDLE_OFFSET_PX = 26; // how far above the top edge the rotate handle floats
const ROTATE_HANDLE_RADIUS_PX = 7;
const ROTATE_SNAP_DEG = 15; // rotate-handle drag snaps to this increment when close
const ROTATE_SNAP_THRESHOLD_DEG = 3;
const LONG_PRESS_MS = 500; // press-and-hold duration that opens the Cut/Copy/Delete menu
const STROKE_WIDTH_PDF_PTS = 4; // pencil stroke thickness in PDF points -> scales with the plan, like symbols
const STROKE_OPACITY = 0.55; // translucent marker look, matching the reference markup style
const STROKE_MIN_POINT_DIST_PX = 2; // drop points closer together than this to keep stroke data lean
export const PEN_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#000000', '#ffffff'];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Traces a smoothed path through raw freehand points onto an already-opened
// canvas path (caller does ctx.beginPath()/ctx.stroke()). Finger/Pencil input
// is sampled fast enough that consecutive points are close together but
// rarely perfectly collinear, so connecting them with straight lineTo()
// segments makes every little wobble in the original drag show up as a
// visible kink/facet once the line is thick and zoomed in. The standard fix
// (used by most freehand-drawing canvases) is to curve through the MIDPOINT
// of each pair of consecutive points, using the shared point between them as
// the quadratic control point — that low-pass-filters exactly the small
// direction changes, while still hugging the original path closely since
// points are only a few pixels apart. export.js's strokeToPngBytes() mirrors
// this exact logic so on-screen drawing and the exported PDF match.
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
  // Curve through the final two points so the path actually reaches the
  // last recorded point instead of stopping at the second-to-last midpoint.
  ctx.quadraticCurveTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
}

export class Stage {
  constructor(container, pdfSource, { onSymbolsChanged, onSelectionChanged, onStrokeSelectionChanged, onArmedChanged, onLongPress, onPastePillRequested, onPastePillDismissed } = {}) {
    this.container = container;
    this.pdfSource = pdfSource;
    this.onSymbolsChanged = onSymbolsChanged || (() => {});
    this.onSelectionChanged = onSelectionChanged || (() => {});
    this.onStrokeSelectionChanged = onStrokeSelectionChanged || (() => {});
    this.onArmedChanged = onArmedChanged || (() => {});
    this.onLongPress = onLongPress || (() => {});
    this.onPastePillRequested = onPastePillRequested || (() => {});
    this.onPastePillDismissed = onPastePillDismissed || (() => {});

    this.pdfCanvas = document.createElement('canvas');
    this.pdfCanvas.className = 'stage-canvas stage-canvas-pdf';
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'stage-canvas stage-canvas-overlay';
    container.appendChild(this.pdfCanvas);
    container.appendChild(this.overlayCanvas);

    this.view = { scale: 1, offsetX: 0, offsetY: 0 };
    this.symbols = []; // {id, defId, x, y (pdf pts), rotation (deg)}
    this.strokes = []; // {id, color, points: [{x,y} in pdf pts]} — freeform pencil markup
    this.selectedId = null;
    this.selectedStrokeId = null; // mutually exclusive with selectedId — selecting one clears the other
    this.armedDefId = null; // symbol currently selected in the palette, ready to place
    this._armedRotation = 0; // rotation to place with — nonzero only for a Copy/Cut paste-arm
    this._armedStrokeTemplate = null; // {color, points} armed by copying/cutting a stroke, ready to place
    this._pasteArmed = false; // true when armedDefId/_armedStrokeTemplate came from Copy/Cut rather than a fresh palette pick
    this._pendingPastePoint = null; // pdf point captured by a hold, waiting on the Paste pill being tapped
    this.stampMode = false;
    this.penMode = false; // when true, a single-finger drag draws instead of panning/placing
    this.penColor = PEN_COLORS[0]; // default red
    this._drawingStroke = null; // the in-progress stroke object, while dragMode === 'draw'
    this._lastDrawScreenPt = null;

    this._dpr = window.devicePixelRatio || 1;
    this._pointers = new Map(); // pointerId -> {x,y}
    this._dragMode = null; // 'pan' | 'move-symbol' | 'rotate-handle' | 'pinch' | 'place-pending' | null
    this._dragSymbolId = null;
    this._dragStart = null;
    this._rotateSymbolId = null;
    this._rotateBaseAngle = 0;
    this._rotateCenterScreen = null;
    this._longPressTimer = null;
    this._pinchStartDist = null;
    this._pinchStartScale = null;
    this._pinchStartMid = null;
    this._pinchAnchorPdf = null;
    this._pinchRafPending = false;
    this._movedSincePointerDown = false;

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(container);

    this._bindEvents();
  }

  _newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  // ---- public API -------------------------------------------------------

  setSymbols(symbols) {
    this.symbols = symbols || [];
    this._renderOverlay();
  }

  getSymbols() {
    return this.symbols;
  }

  setStrokes(strokes) {
    this.strokes = strokes || [];
    this._renderOverlay();
  }

  getStrokes() {
    return this.strokes;
  }

  // Swap in a different page's placed symbols/strokes (the caller — main.js —
  // owns the full project's data and hands us just the slice for whichever
  // page is now current). Deliberately does NOT touch armedDefId, stampMode,
  // penMode, or penColor: those are tool settings, not page content, and a
  // user mid-way through stamping the same head across a sheet set expects
  // to still be armed after flipping to the next page. Re-fits the view since
  // sheets in a set aren't guaranteed to share the same dimensions.
  async loadPageData(symbols, strokes) {
    this.select(null);
    this.dismissPastePill(); // a pending pill's position is tied to the old page's view, now stale
    this.symbols = symbols || [];
    this.strokes = strokes || [];
    await this.fitToScreen();
  }

  // Pencil tool: while on, a single-finger drag draws instead of panning or
  // selecting/moving symbols (two-finger pinch/pan still works). Arming a
  // palette symbol and pen mode are mutually exclusive, so turning pen mode
  // on disarms whatever was armed.
  setPenMode(v) {
    this.penMode = v;
    if (v) {
      this.armedDefId = null;
      this._armedRotation = 0;
      this._armedStrokeTemplate = null;
      this._pasteArmed = false;
      this.dismissPastePill();
      this.onArmedChanged(this.armedDefId);
      this.select(null);
    }
  }

  setPenColor(color) {
    this.penColor = color;
  }

  undoLastStroke() {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this._emitChanged();
    this._renderOverlay();
  }

  armSymbol(defId) {
    this.armedDefId = defId;
    this._armedRotation = 0; // a fresh palette pick always starts upright
    this._armedStrokeTemplate = null;
    this._pasteArmed = false; // fresh palette picks never use the hold-for-Paste-pill flow
    this.dismissPastePill();
    this.penMode = false; // arming a symbol exits the pencil tool
    this.onArmedChanged(this.armedDefId);
  }

  disarmSymbol() {
    this.armedDefId = null;
    this._armedRotation = 0;
    this._armedStrokeTemplate = null;
    this._pasteArmed = false;
    this.dismissPastePill();
    this.onArmedChanged(this.armedDefId);
  }

  // Copy: arm a paste of whatever's selected — a symbol (same defId +
  // rotation) or a stroke (same shape/color) — without touching the
  // original. A quick tap on the plan drops the copy there immediately,
  // same as arming a symbol from the palette — but a *hold* instead shows a
  // "Paste" pill (see _onPointerDown/confirmPendingPaste) that keeps the
  // paste armed after you use it, so you can hold again elsewhere and place
  // as many copies as you want without re-copying.
  copySelected() {
    if (this.selectedStrokeId) {
      this._armStrokeTemplate(this._selectedStroke());
      this.selectStroke(null);
      return;
    }
    const s = this._selectedSymbol();
    if (!s) return;
    this.armedDefId = s.defId;
    this._armedRotation = s.rotation || 0;
    this._pasteArmed = true;
    this.onArmedChanged(this.armedDefId);
    this.select(null);
  }

  // Cut: same paste-arm as Copy, but removes the original immediately —
  // net effect is "move this symbol/line to wherever I tap next (or hold+Paste)."
  cutSelected() {
    if (this.selectedStrokeId) {
      const s = this._selectedStroke();
      if (!s) return;
      this._armStrokeTemplate(s);
      this.strokes = this.strokes.filter((st) => st.id !== s.id);
      this.selectedStrokeId = null;
      this.onStrokeSelectionChanged(null);
      this._emitChanged();
      this._renderOverlay();
      return;
    }
    const s = this._selectedSymbol();
    if (!s) return;
    this.armedDefId = s.defId;
    this._armedRotation = s.rotation || 0;
    this._pasteArmed = true;
    this.onArmedChanged(this.armedDefId);
    this.symbols = this.symbols.filter((sym) => sym.id !== s.id);
    this.selectedId = null;
    this.onSelectionChanged(null);
    this._emitChanged();
    this._renderOverlay();
  }

  _armStrokeTemplate(stroke) {
    if (!stroke) return;
    this._armedStrokeTemplate = { color: stroke.color, points: stroke.points.map((p) => ({ x: p.x, y: p.y })) };
    this._pasteArmed = true;
    // No palette item corresponds to "a copied line," so there's nothing to
    // highlight there — but armed-state UI elsewhere (e.g. exiting on a new
    // palette pick) still needs to hear that something changed.
    this.onArmedChanged(null);
  }

  // Places the pending copy at the point captured when the Paste pill was
  // requested (the hold that triggered it). Always leaves the paste armed
  // afterward — regardless of Stamp mode — since the entire point of
  // hold-for-a-pill is repeatable placement without re-copying each time.
  confirmPendingPaste() {
    if (!this._pendingPastePoint || (!this.armedDefId && !this._armedStrokeTemplate)) return;
    this._placeArmedAtPdfPoint(this._pendingPastePoint, { keepArmed: true });
    this._pendingPastePoint = null;
    if (this._dragMode === 'paste-pill-pending') this._dragMode = null;
    this.onPastePillDismissed();
  }

  // Hides the pill (if showing) without placing anything — called whenever
  // something else invalidates a pending hold: starting a new gesture on the
  // canvas, disarming, switching pages, etc.
  dismissPastePill() {
    if (this._pendingPastePoint === null) return;
    this._pendingPastePoint = null;
    if (this._dragMode === 'paste-pill-pending') this._dragMode = null;
    this.onPastePillDismissed();
  }

  setStampMode(v) {
    this.stampMode = v;
  }

  // Selecting a symbol always clears any stroke selection (the two are
  // mutually exclusive — only one thing selected at a time), including the
  // general "deselect everything" case of select(null), which is why this
  // doesn't gate the stroke-clearing on `id` being non-null.
  select(id) {
    this.selectedId = id;
    if (this.selectedStrokeId !== null) {
      this.selectedStrokeId = null;
      this.onStrokeSelectionChanged(null);
    }
    this.onSelectionChanged(this._selectedSymbol());
    this._renderOverlay();
  }

  selectStroke(id) {
    this.selectedStrokeId = id;
    if (this.selectedId !== null) {
      this.selectedId = null;
      this.onSelectionChanged(null);
    }
    this.onStrokeSelectionChanged(this._selectedStroke());
    this._renderOverlay();
  }

  deleteSelected() {
    if (this.selectedStrokeId) {
      this.strokes = this.strokes.filter((s) => s.id !== this.selectedStrokeId);
      this.selectedStrokeId = null;
      this.onStrokeSelectionChanged(null);
      this._emitChanged();
      this._renderOverlay();
      return;
    }
    if (!this.selectedId) return;
    this.symbols = this.symbols.filter((s) => s.id !== this.selectedId);
    this.selectedId = null;
    this.onSelectionChanged(null);
    this._emitChanged();
    this._renderOverlay();
  }

  rotateSelected(deltaDeg) {
    const s = this._selectedSymbol();
    if (!s) return;
    s.rotation = ((s.rotation || 0) + deltaDeg + 360) % 360;
    this._emitChanged();
    this._renderOverlay();
  }

  async fitToScreen() {
    const { width, height } = this.pdfSource.pageSize;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const scale = Math.min(cw / width, ch / height) * 0.95;
    this.view.scale = scale;
    this.view.offsetX = (cw - width * scale) / 2;
    this.view.offsetY = (ch - height * scale) / 2;
    await this._renderPdf();
    this._renderOverlay();
  }

  async zoomBy(factor, centerScreen) {
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const center = centerScreen || { x: cw / 2, y: ch / 2 };
    const pdfPt = this._screenToPdf(center);
    let newScale = this.view.scale * factor;
    newScale = Math.min(Math.max(newScale, MIN_SCALE), MAX_SCALE);
    this.view.scale = newScale;
    // keep the point under the cursor/finger fixed
    this.view.offsetX = center.x - pdfPt.x * newScale;
    this.view.offsetY = center.y - pdfPt.y * newScale;
    await this._renderPdf();
    this._renderOverlay();
  }

  destroy() {
    this._cancelLongPress();
    this._resizeObserver.disconnect();
  }

  // ---- coordinate transforms ---------------------------------------------

  _pdfToScreen(p) {
    return {
      x: p.x * this.view.scale + this.view.offsetX,
      y: p.y * this.view.scale + this.view.offsetY,
    };
  }

  _screenToPdf(p) {
    return {
      x: (p.x - this.view.offsetX) / this.view.scale,
      y: (p.y - this.view.offsetY) / this.view.scale,
    };
  }

  _selectedSymbol() {
    return this.symbols.find((s) => s.id === this.selectedId) || null;
  }

  // Public accessor for the long-press Favorite button in main.js — it needs
  // the definition id (which palette/symbolPrefs favoriting keys off of),
  // not the placed-instance id, and returns null for a stroke selection (or
  // no selection) so the caller knows to hide the button entirely.
  getSelectedDefId() {
    const s = this._selectedSymbol();
    return s ? s.defId : null;
  }

  _selectedStroke() {
    return this.strokes.find((s) => s.id === this.selectedStrokeId) || null;
  }

  // ---- rendering ----------------------------------------------------------

  _onResize() {
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    for (const c of [this.pdfCanvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.round(cw * this._dpr));
      c.height = Math.max(1, Math.round(ch * this._dpr));
      c.style.width = cw + 'px';
      c.style.height = ch + 'px';
    }
    this._renderPdf();
    this._renderOverlay();
  }

  async _renderPdf() {
    if (!this.pdfSource.pdfDoc) return;
    const { canvas: raster } = await this.pdfSource.ensureRaster(this.view.scale * this._dpr);
    const ctx = this.pdfCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);
    const { width, height } = this.pdfSource.pageSize;
    const dx = this.view.offsetX * this._dpr;
    const dy = this.view.offsetY * this._dpr;
    const dw = width * this.view.scale * this._dpr;
    const dh = height * this.view.scale * this._dpr;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(raster, 0, 0, raster.width, raster.height, dx, dy, dw, dh);
  }

  _renderOverlay() {
    const ctx = this.overlayCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const size = SYMBOL_SIZE_PDF_PTS * this.view.scale;
    for (const s of this.symbols) {
      const def = SYMBOLS_BY_ID[s.defId];
      if (!def) continue;
      const { img, promise } = getSymbolImage(s.defId);
      const screen = this._pdfToScreen(s);
      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(((s.rotation || 0) * Math.PI) / 180);
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
      } else {
        promise.then(() => this._renderOverlay());
      }
      ctx.restore();

      if (s.id === this.selectedId) {
        this._drawSelectionHandles(ctx, s, screen, size);
      }
    }

    this._renderStrokes(ctx);
    this._positionSelectionToolbar();
  }

  // Freeform pencil markup, drawn on top of symbols (same convention as the
  // reference: highlighter-style call-outs sit over the plan content). A
  // 1-point stroke (a tap with no drag) renders as a filled dot, same as a
  // single dab of a marker.
  _renderStrokes(ctx) {
    if (this.strokes.length === 0) return;
    for (const stroke of this.strokes) {
      if (!stroke.points || stroke.points.length === 0) continue;
      const lineWidth = Math.max(STROKE_WIDTH_PDF_PTS * this.view.scale, 2);
      ctx.save();
      ctx.globalAlpha = STROKE_OPACITY;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.points.length === 1) {
        const p = this._pdfToScreen(stroke.points[0]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const pts = stroke.points.map((p) => this._pdfToScreen(p));
        ctx.beginPath();
        traceSmoothPath(ctx, pts);
        ctx.stroke();
      }
      ctx.restore();

      if (stroke.id === this.selectedStrokeId) {
        this._drawStrokeSelectionHighlight(ctx, stroke);
      }
    }
  }

  // Dashed bounding-box highlight for a selected stroke — same visual
  // language as a selected symbol's dashed box, just without the corner
  // dots/rotate handle (a freeform line has no single "rotation" to grab).
  _drawStrokeSelectionHighlight(ctx, stroke) {
    const bounds = this._strokeBoundsScreen(stroke);
    if (!bounds) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.restore();
  }

  _strokeBoundsScreen(stroke) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return null;
    const pad = 10;
    const pts = stroke.points.map((p) => this._pdfToScreen(p));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minY: Math.min(...ys) - pad,
      maxY: Math.max(...ys) + pad,
    };
  }

  _drawSelectionHandles(ctx, s, screen, size) {
    const half = Math.max(size / 2, HANDLE_MIN_HALF_PX) + HANDLE_MARGIN_PX;
    const rot = ((s.rotation || 0) * Math.PI) / 180;

    // Dashed bounding box + the stalk connecting its top edge to the rotate
    // handle above it — drawn together, in the symbol's own rotated local
    // frame, so both track rotation identically with no separate math.
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(rot);
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, -half - ROTATE_HANDLE_OFFSET_PX);
    ctx.stroke();
    ctx.restore();

    ctx.setLineDash([]);
    for (const h of this._handlePositions(s)) {
      ctx.beginPath();
      if (h.corner === 'rotate') {
        ctx.arc(h.x, h.y, ROTATE_HANDLE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.arc(h.x, h.y, HANDLE_VISUAL_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }
  }

  // Handle positions for a selected symbol, in current screen space — the 4
  // corner dots (visual only, marking the selection's footprint) plus the
  // single rotate handle floating above the top edge. `baseAngleDeg` is each
  // handle's angle from the symbol's center at rotation=0, so a drag on the
  // rotate handle can solve "what rotation puts this handle under the
  // pointer" the same way regardless of the symbol's current rotation.
  _handlePositions(s) {
    const size = SYMBOL_SIZE_PDF_PTS * this.view.scale;
    const half = Math.max(size / 2, HANDLE_MIN_HALF_PX) + HANDLE_MARGIN_PX;
    const screen = this._pdfToScreen(s);
    const rot = ((s.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const points = [
      { corner: 'tl', bx: -half, by: -half, baseAngleDeg: -135 },
      { corner: 'tr', bx: half, by: -half, baseAngleDeg: -45 },
      { corner: 'br', bx: half, by: half, baseAngleDeg: 45 },
      { corner: 'bl', bx: -half, by: half, baseAngleDeg: 135 },
      { corner: 'rotate', bx: 0, by: -half - ROTATE_HANDLE_OFFSET_PX, baseAngleDeg: -90 },
    ];
    return points.map((c) => ({
      corner: c.corner,
      baseAngleDeg: c.baseAngleDeg,
      x: screen.x + c.bx * cos - c.by * sin,
      y: screen.y + c.bx * sin + c.by * cos,
    }));
  }

  _positionSelectionToolbar() {
    const evt = new CustomEvent('stage:overlay-rendered');
    this.container.dispatchEvent(evt);
  }

  screenPositionOf(symbolId) {
    const s = this.symbols.find((sym) => sym.id === symbolId);
    if (!s) return null;
    return this._pdfToScreen(s);
  }

  // Bounding box of the rotation handles in screen space — rotation can put
  // any corner on top, so callers (e.g. positioning the floating toolbar
  // clear of the handles) need the actual extent, not just the center.
  selectionBoundsScreen(symbolId) {
    const s = this.symbols.find((sym) => sym.id === symbolId);
    if (!s) return null;
    const handles = this._handlePositions(s);
    const xs = handles.map((h) => h.x);
    const ys = handles.map((h) => h.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    };
  }

  // Same idea as selectionBoundsScreen above, but for a stroke: just the
  // padded bounding box of its points (no handles to account for), used to
  // position the long-press Cut/Copy/Delete menu above it.
  strokeSelectionBoundsScreen(strokeId) {
    const stroke = this.strokes.find((s) => s.id === strokeId);
    const bounds = this._strokeBoundsScreen(stroke);
    if (!bounds) return null;
    return { ...bounds, centerX: (bounds.minX + bounds.maxX) / 2 };
  }

  // ---- events ---------------------------------------------------------

  _bindEvents() {
    const el = this.overlayCanvas;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    // Belt-and-suspenders alongside the -webkit-touch-callout: none CSS rule
    // on .stage-container: a long-press on iOS Safari can still raise the
    // browser's own native context menu (Copy/Look Up/Translate) via a real
    // 'contextmenu' event on some WebKit versions even with that CSS in
    // place. Block it outright so it can never race against — or replace —
    // our own long-press-driven Cut/Copy/Delete menu.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // The CSS callout suppression above turned out not to be enough on its
    // own (confirmed on-device: iOS Safari's native "Copy / Find Selection /
    // Look Up / Translate" menu still won the race). The gesture recognizer
    // behind that menu is tied to the browser's own touch handling, not just
    // rendering/selection CSS — explicitly preventing the default action of
    // the raw touchstart (not just our synthesized pointerdown) is what
    // actually stops iOS from ever starting that gesture in the first
    // place. Pointer events still fire normally (they dispatch before the
    // corresponding touch event and aren't affected by this), so none of
    // the tap/drag/pinch/rotate/long-press logic above is impacted — this
    // only blocks the native menu. Must be non-passive to be allowed to
    // preventDefault() at all.
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  _localPoint(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitTest(screenPt) {
    const size = SYMBOL_SIZE_PDF_PTS * this.view.scale;
    const radius = Math.max(size / 2, 14);
    let best = null;
    let bestDist = Infinity;
    for (let i = this.symbols.length - 1; i >= 0; i--) {
      const s = this.symbols[i];
      const screen = this._pdfToScreen(s);
      const d = dist(screen, screenPt);
      if (d <= radius && d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  // Finds the topmost (last-drawn) stroke passing near screenPt, within a
  // touch-friendly radius of the line itself — checked only when nothing
  // higher-priority (a symbol, a handle) was hit, so a line that happens to
  // pass near/under a symbol never steals a tap meant for that symbol.
  _hitTestStroke(screenPt) {
    const lineWidth = Math.max(STROKE_WIDTH_PDF_PTS * this.view.scale, 2);
    const threshold = Math.max(lineWidth / 2 + 10, 14);
    let best = null;
    let bestDist = Infinity;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      if (!stroke.points || stroke.points.length === 0) continue;
      const pts = stroke.points.map((p) => this._pdfToScreen(p));
      const d = pts.length === 1 ? dist(pts[0], screenPt) : this._distToPolyline(screenPt, pts);
      if (d <= threshold && d < bestDist) {
        best = stroke;
        bestDist = d;
      }
    }
    return best;
  }

  _distToPolyline(p, pts) {
    let min = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      min = Math.min(min, this._distToSegment(p, pts[i], pts[i + 1]));
    }
    return min;
  }

  _distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  // Only the dedicated rotate handle is interactive — the 4 corner dots are
  // a visual footprint indicator only (matching the reference design), not
  // a grabbable control.
  _hitTestHandle(screenPt) {
    if (!this.selectedId) return null;
    const s = this.symbols.find((sym) => sym.id === this.selectedId);
    if (!s) return null;
    const rotateHandle = this._handlePositions(s).find((h) => h.corner === 'rotate');
    if (rotateHandle && dist(rotateHandle, screenPt) <= HANDLE_HIT_RADIUS_PX) return rotateHandle;
    return null;
  }

  _onPointerDown(e) {
    try {
      this.overlayCanvas.setPointerCapture(e.pointerId);
    } catch (_) {
      // Some environments (or synthetic/replayed input) can reject capture
      // for a pointer id that isn't currently "active" from the browser's
      // point of view. Capture is a nice-to-have (keeps events flowing to
      // this element even if a finger slides off it); losing it shouldn't
      // stop placement/pan/pinch from working.
    }
    const p = this._localPoint(e);
    this._pointers.set(e.pointerId, p);
    this._movedSincePointerDown = false;
    // A second finger arriving mid-gesture means this was never a one-finger
    // long-press — cancel any pending timer from the first finger's touch.
    this._cancelLongPress();
    // Starting any new gesture invalidates a pill left over from an earlier
    // hold (its position is tied to that specific spot on the plan) — clear
    // it rather than leaving a stale "Paste" button floating on screen.
    this.dismissPastePill();

    if (this._pointers.size === 2) {
      // A second finger landing mid-stroke means "pinch to zoom", not
      // "keep drawing" — finalize whatever's been drawn so far rather than
      // losing it or leaving a half-finished stroke in the data.
      this._finishDrawing();
      const pts = [...this._pointers.values()];
      this._pinchStartDist = dist(pts[0], pts[1]);
      this._pinchStartScale = this.view.scale;
      this._pinchStartMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      // Fixed for the whole gesture: which PDF point sits under the pinch
      // midpoint right now. Recomputing this every move frame (instead of
      // once here) was the bug — it read the *already-updated* view each
      // frame, so the anchor crept away from your fingers as you pinched.
      this._pinchAnchorPdf = this._screenToPdf(this._pinchStartMid);
      this._dragMode = 'pinch';
      return;
    }

    if (this._pointers.size === 1) {
      if (this.penMode) {
        // Pen mode owns single-finger interaction entirely — no placement,
        // selection, rotate-handle, or pan while it's active.
        const pdfPt = this._screenToPdf(p);
        this._drawingStroke = { id: this._newId('stroke'), color: this.penColor, points: [pdfPt] };
        this.strokes.push(this._drawingStroke);
        this._lastDrawScreenPt = p;
        this._dragMode = 'draw';
        this._dragStart = p;
        this._renderOverlay();
        return;
      }

      if (this.armedDefId || this._armedStrokeTemplate) {
        // placement happens on pointerup (tap), to avoid placing mid-pan gesture
        this._dragMode = 'place-pending';
        this._dragStart = p;
        if (this._pasteArmed) {
          // A Copy/Cut paste additionally supports holding: instead of
          // placing immediately on release, a hold shows a "Paste" pill at
          // this spot and leaves the actual placement up to tapping it (see
          // confirmPendingPaste). A plain quick tap still places instantly
          // (handled in _onPointerUp) — this timer only fires if the finger
          // stays down past LONG_PRESS_MS without moving.
          this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            if (this._dragMode !== 'place-pending' || this._movedSincePointerDown) return;
            this._dragMode = 'paste-pill-pending';
            this._pendingPastePoint = this._screenToPdf(p);
            this.onPastePillRequested(p);
          }, LONG_PRESS_MS);
        }
        return;
      }

      const handle = this._hitTestHandle(p);
      if (handle) {
        const s = this._selectedSymbol();
        this._dragMode = 'rotate-handle';
        this._rotateSymbolId = s.id;
        this._rotateBaseAngle = handle.baseAngleDeg;
        this._rotateCenterScreen = this._pdfToScreen(s);
        this._dragStart = p;
        return;
      }

      const hit = this._hitTest(p);
      if (hit) {
        this.select(hit.id);
        this._dragMode = 'move-symbol';
        this._dragSymbolId = hit.id;
        this._dragStart = p;
        // Press-and-hold on a symbol (without moving) opens the Cut/Copy/
        // Delete menu. If the pointer moves past the tap threshold or lifts
        // before this fires, _cancelLongPress() below throws it away and
        // the normal move-symbol drag proceeds instead.
        this._longPressTimer = setTimeout(() => {
          this._longPressTimer = null;
          if (this._dragMode !== 'move-symbol' || this._dragSymbolId !== hit.id || this._movedSincePointerDown) return;
          this._dragMode = 'long-press-menu';
          this.onLongPress(hit.id, this._pdfToScreen(hit));
        }, LONG_PRESS_MS);
        return;
      }

      // Nothing solid (symbol/handle) under the finger — check for a drawn
      // line before falling back to panning, so a tap on a pencil stroke
      // selects it instead of starting a pan. No drag-to-move support for
      // strokes (out of scope) — touching one just selects it; moving the
      // finger afterward does nothing (see _onPointerMove), same as it
      // would for panning from empty space, just without the pan.
      const strokeHit = this._hitTestStroke(p);
      if (strokeHit) {
        this.selectStroke(strokeHit.id);
        this._dragMode = 'stroke-selected';
        this._dragStart = p;
        // Press-and-hold on a stroke (without moving) opens the same
        // Cut/Copy/Delete menu a symbol's long-press does.
        this._longPressTimer = setTimeout(() => {
          this._longPressTimer = null;
          if (this._dragMode !== 'stroke-selected' || this.selectedStrokeId !== strokeHit.id || this._movedSincePointerDown) return;
          this._dragMode = 'long-press-menu';
          this.onLongPress(strokeHit.id);
        }, LONG_PRESS_MS);
        return;
      }

      this._dragMode = 'pan';
      this._dragStart = p;
      this._panStartOffset = { x: this.view.offsetX, y: this.view.offsetY };
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const p = this._localPoint(e);
    this._pointers.set(e.pointerId, p);

    if (this._dragMode === 'pinch' && this._pointers.size === 2) {
      // The browser delivers one pointermove per finger, not one combined
      // event — so at the instant either fires, the *other* finger's stored
      // position is one event stale. Recomputing scale/offset immediately
      // here mixes a fresh coordinate with a stale one and makes the pinch
      // lurch. Instead, just record the latest position and coalesce both
      // fingers' updates into a single recompute per animation frame.
      this._schedulePinchUpdate();
      return;
    }

    if (this._dragStart && dist(this._dragStart, p) > TAP_MOVE_THRESHOLD) {
      this._movedSincePointerDown = true;
      // Real movement means this is a drag, not a hold — don't let a
      // still-pending long-press timer fire later and hijack it.
      this._cancelLongPress();
    }

    if (this._dragMode === 'draw') {
      if (this._drawingStroke && this._lastDrawScreenPt && dist(this._lastDrawScreenPt, p) >= STROKE_MIN_POINT_DIST_PX) {
        this._drawingStroke.points.push(this._screenToPdf(p));
        this._lastDrawScreenPt = p;
        this._movedSincePointerDown = true;
        this._renderOverlay();
      }
      return;
    }

    if (this._dragMode === 'rotate-handle') {
      const s = this.symbols.find((sym) => sym.id === this._rotateSymbolId);
      if (s) {
        const center = this._rotateCenterScreen;
        const pointerAngleDeg = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
        let newRotation = pointerAngleDeg - this._rotateBaseAngle;
        newRotation = ((newRotation % 360) + 360) % 360;
        // Snap to clean 15° increments when close, so it's easy to land on
        // square/45°-ish orientations without needing pixel-perfect aim.
        const nearestSnap = Math.round(newRotation / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
        const snapDiff = Math.abs(((newRotation - nearestSnap + 180) % 360) - 180);
        if (snapDiff < ROTATE_SNAP_THRESHOLD_DEG) newRotation = ((nearestSnap % 360) + 360) % 360;
        s.rotation = newRotation;
        this._movedSincePointerDown = true;
        this._renderOverlay();
      }
      return;
    }

    if (this._dragMode === 'move-symbol' && this._movedSincePointerDown) {
      const s = this.symbols.find((sym) => sym.id === this._dragSymbolId);
      if (s) {
        const pdfPt = this._screenToPdf(p);
        s.x = pdfPt.x;
        s.y = pdfPt.y;
        this._renderOverlay();
      }
    } else if (this._dragMode === 'pan' && this._movedSincePointerDown) {
      const dx = p.x - this._dragStart.x;
      const dy = p.y - this._dragStart.y;
      this.view.offsetX = this._panStartOffset.x + dx;
      this.view.offsetY = this._panStartOffset.y + dy;
      this._renderPdf();
      this._renderOverlay();
    }
  }

  _schedulePinchUpdate() {
    if (this._pinchRafPending) return;
    this._pinchRafPending = true;
    requestAnimationFrame(() => {
      this._pinchRafPending = false;
      if (this._dragMode !== 'pinch' || this._pointers.size !== 2) return;
      const pts = [...this._pointers.values()];
      const d = dist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const rawScale = this._pinchStartScale * (d / this._pinchStartDist);
      const newScale = Math.min(Math.max(rawScale, MIN_SCALE), MAX_SCALE);
      this.view.scale = newScale;
      this.view.offsetX = mid.x - this._pinchAnchorPdf.x * newScale;
      this.view.offsetY = mid.y - this._pinchAnchorPdf.y * newScale;
      this._renderPdf();
      this._renderOverlay();
    });
  }

  _cancelLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  // Ends whatever stroke is in progress, if any — a no-op if nothing's being
  // drawn. Even a plain tap (no movement) leaves a 1-point stroke, which
  // renders as a dot; that's intentional, same as a single dab of a marker.
  _finishDrawing() {
    if (!this._drawingStroke) return;
    this._drawingStroke = null;
    this._lastDrawScreenPt = null;
    this._emitChanged();
  }

  _onPointerUp(e) {
    this._cancelLongPress();
    const p = this._localPoint(e);
    this._pointers.delete(e.pointerId);

    if (this._dragMode === 'draw') {
      this._finishDrawing();
    } else if (this._dragMode === 'place-pending' && !this._movedSincePointerDown) {
      this._placeAt(p);
    } else if (this._dragMode === 'move-symbol') {
      if (this._movedSincePointerDown) this._emitChanged();
    } else if (this._dragMode === 'rotate-handle') {
      if (this._movedSincePointerDown) this._emitChanged();
    } else if (this._dragMode === 'pan') {
      if (!this._movedSincePointerDown) {
        // plain tap on empty space -> deselect
        this.select(null);
      }
    }

    if (this._pointers.size === 0) {
      this._dragMode = null;
      this._dragSymbolId = null;
      this._dragStart = null;
      this._rotateSymbolId = null;
    } else if (this._pointers.size === 1) {
      // dropped out of pinch back to a single pointer; restart as pan
      const [p1] = [...this._pointers.values()];
      this._dragMode = 'pan';
      this._dragStart = p1;
      this._panStartOffset = { x: this.view.offsetX, y: this.view.offsetY };
      // Coming out of a pinch, treat this as "already moved" so lifting the
      // second finger a beat later can't be misread as a tap-to-deselect.
      this._movedSincePointerDown = true;
    }
  }

  _placeAt(screenPt) {
    this._placeArmedAtPdfPoint(this._screenToPdf(screenPt));
  }

  // Dispatches to whichever thing is currently armed — a symbol defId (from
  // the palette or a symbol Copy/Cut) or a stroke template (from a stroke
  // Copy/Cut). Both quick-tap placement and Paste-pill confirmation funnel
  // through here so neither path has to know which kind it's placing.
  _placeArmedAtPdfPoint(pdfPt, opts = {}) {
    if (this._armedStrokeTemplate) {
      this._placeStrokeAtPdfPoint(pdfPt, opts);
    } else {
      this._placeSymbolAtPdfPoint(pdfPt, opts);
    }
  }

  // keepArmed: true bypasses the normal Stamp-mode-dependent disarm — used by
  // confirmPendingPaste() so a Paste-pill placement always leaves the paste
  // armed for the next hold, regardless of whether Stamp mode happens to be on.
  _placeSymbolAtPdfPoint(pdfPt, { keepArmed = false } = {}) {
    const id = this._newId('s');
    const symbol = { id, defId: this.armedDefId, x: pdfPt.x, y: pdfPt.y, rotation: this._armedRotation || 0 };
    this.symbols.push(symbol);
    this.select(id);
    if (!keepArmed && !this.stampMode) {
      this.armedDefId = null;
      this._armedRotation = 0;
      this._pasteArmed = false;
      this.onArmedChanged(this.armedDefId);
    }
    this._emitChanged();
    this._renderOverlay();
  }

  // Places a copied/cut stroke's shape translated so its first point lands
  // at pdfPt (an arbitrary but consistent anchor — same behavior a user
  // would read as "drop the shape here" regardless of where within it they
  // originally started drawing).
  _placeStrokeAtPdfPoint(pdfPt, { keepArmed = false } = {}) {
    const tmpl = this._armedStrokeTemplate;
    if (!tmpl || !tmpl.points.length) return;
    const anchor = tmpl.points[0];
    const dx = pdfPt.x - anchor.x;
    const dy = pdfPt.y - anchor.y;
    const id = this._newId('stroke');
    const points = tmpl.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    this.strokes.push({ id, color: tmpl.color, points });
    this.selectStroke(id);
    if (!keepArmed && !this.stampMode) {
      this._armedStrokeTemplate = null;
      this._pasteArmed = false;
      this.onArmedChanged(null);
    }
    this._emitChanged();
    this._renderOverlay();
  }

  _onWheel(e) {
    e.preventDefault();
    const p = this._localPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoomBy(factor, p);
  }

  _emitChanged() {
    this.onSymbolsChanged(this.symbols);
  }
}
