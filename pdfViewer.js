// PDF.js integration: load a PDF from bytes, render a page onto a canvas.
// Keeps a cap on render resolution so large (e.g. 36x24) sheets don't choke
// iPad Safari, and re-rasterizes at a higher resolution when the user zooms
// in past what the current raster can cleanly support.

import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const MAX_INITIAL_PIXELS = 2600; // cap longest side of the initial raster
const MAX_RENDER_PIXELS = 6200; // cap longest side even when zoomed in, to protect memory

export class PdfViewerSource {
  constructor() {
    this.pdfDoc = null;
    this.page = null;
    this.pageNum = 1;
    this.baseViewport = null; // viewport at scale 1 (PDF points)
    this.pdfBytes = null;
    this._renderedScale = 0; // scale (raster px per PDF point) of the current backing canvas
    this._renderCanvas = document.createElement('canvas');
    this._renderTask = null;
  }

  async loadFromBytes(bytes) {
    this.pdfBytes = bytes;
    // pdf.js detaches/transfers the buffer in some paths; keep our own copy for export/storage.
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
    this.pdfDoc = await loadingTask.promise;
    this.pageNum = 1;
    await this._loadPage(this.pageNum);
    return {
      numPages: this.pdfDoc.numPages,
      width: this.baseViewport.width,
      height: this.baseViewport.height,
    };
  }

  get numPages() {
    return this.pdfDoc ? this.pdfDoc.numPages : 1;
  }

  // Switch the active page (1-based). Sheets in a set are usually the same
  // size, but nothing here assumes that — pageSize always reflects whichever
  // page is currently loaded, so callers that care (Stage#fitToScreen) just
  // re-read it after this resolves.
  async goToPage(pageNum) {
    const clamped = Math.min(Math.max(1, pageNum), this.numPages);
    if (clamped === this.pageNum && this.page) return this.pageSize;
    this.pageNum = clamped;
    await this._loadPage(clamped);
    return this.pageSize;
  }

  async _loadPage(pageNum) {
    this.page = await this.pdfDoc.getPage(pageNum);
    this.baseViewport = this.page.getViewport({ scale: 1 });
    this._renderedScale = 0;
  }

  get pageSize() {
    return { width: this.baseViewport.width, height: this.baseViewport.height };
  }

  // For Find & Place (see textSearch.js): the page's real embedded text
  // items plus the scale-1 viewport transform needed to map them into the
  // same coordinate space this app already places symbols in. Fetches the
  // requested page independently via pdfDoc.getPage() rather than touching
  // this.page/this.pageNum -- callers may want to search a page other than
  // whichever one is currently on screen without disturbing the live view.
  // hasText: false flags a page with no (or only whitespace) text runs --
  // almost always a scanned/flattened page with nothing for this to find,
  // as opposed to a genuine "your search term isn't on this page" zero
  // matches. Callers surface that distinction rather than treating both the
  // same.
  //
  // pdf.js's own getTextContent() (and, rarely, even getPage/getViewport
  // themselves) can throw on certain real-world PDFs -- seen in practice on
  // a page from a CAD-exported fire alarm layout that otherwise renders and
  // displays fine. That's an internal parsing issue in the vendored
  // library, not something this app can fix directly, so this catches it
  // and reports the page as textless (plus textExtractionFailed: true, so
  // callers can word the status differently than a genuinely blank scanned
  // page) rather than letting it hard-fail the whole search -- especially
  // important for "All pages" scope, where one bad page shouldn't block
  // matches on every other page. Deliberately wraps the ENTIRE method body
  // (not just getTextContent()) -- an earlier version left getPage/
  // getViewport outside the try, so a failure there surfaced as a raw,
  // unworded engine error in the UI ("Search failed on page 1: undefined is
  // not a function...") instead of this same graceful message.
  async getPageTextData(pageNum) {
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      // Some CAD-exported PDFs' content streams produce a text item whose
      // `str` isn't a plain string (seen on real-world plans) -- guard the
      // type explicitly rather than trusting `it.str && it.str.trim()`,
      // which throws instead of filtering out a non-string truthy value
      // (e.g. `it.str.trim` is `undefined`, and calling it throws exactly
      // "undefined is not a function").
      const items = textContent.items.filter((it) => typeof it.str === 'string' && it.str.trim());
      return { items, viewportTransform: viewport.transform, hasText: items.length > 0 };
    } catch (err) {
      console.warn(`Find & Place: pdf.js couldn't extract text from page ${pageNum}`, err);
      // viewport may not exist if getPage/getViewport themselves failed --
      // callers only read viewportTransform when hasText is true, but keep
      // this shape-complete (identity transform) rather than undefined.
      // errorDetail carries the raw engine error text through to the status
      // line (see main.js) -- this app is used almost entirely on iPad,
      // where there's no quick way to check a dev console, so a screenshot
      // of the on-screen message needs to be self-diagnosing. Without this,
      // reports of this failure are impossible to root-cause: this exact
      // error hasn't reproduced in desktop testing even against the same
      // real PDF files that failed on-device, so the raw text IS the report.
      const errorDetail = err && err.message ? err.message : String(err);
      return { items: [], viewportTransform: [1, 0, 0, 1, 0, 0], hasText: false, textExtractionFailed: true, errorDetail };
    }
  }

  // Ensure the backing raster canvas covers `desiredScale` (raster px / PDF pt).
  // Returns the backing canvas plus the scale it was actually rendered at.
  async ensureRaster(desiredScale) {
    const longSide = Math.max(this.baseViewport.width, this.baseViewport.height);
    const initialCapScale = MAX_INITIAL_PIXELS / longSide;
    const hardCapScale = MAX_RENDER_PIXELS / longSide;

    let targetScale = Math.min(Math.max(desiredScale, initialCapScale), hardCapScale);

    // Only re-render if we don't have a raster yet, or the current raster is
    // meaningfully lower-res than what's being requested (avoid re-rendering
    // on every tiny pinch-zoom tick).
    const needsRender =
      this._renderedScale === 0 ||
      targetScale > this._renderedScale * 1.25 ||
      (targetScale < this._renderedScale * 0.4 && this._renderedScale > initialCapScale * 1.5);

    if (!needsRender) {
      return { canvas: this._renderCanvas, scale: this._renderedScale };
    }

    // If a render is already in flight, join it instead of cancelling —
    // cancellation races between concurrent callers (e.g. a resize firing
    // right after fitToScreen) otherwise surface as unhandled rejections.
    if (this._renderTask) {
      try {
        await this._renderTask.promise;
      } catch (_) {
        // ignore — whichever render wins, we re-evaluate below
      }
      return this.ensureRaster(desiredScale);
    }

    const viewport = this.page.getViewport({ scale: targetScale });
    const canvas = this._renderCanvas;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');

    const task = this.page.render({ canvasContext: ctx, viewport });
    this._renderTask = task;
    try {
      await task.promise;
      this._renderedScale = targetScale;
    } catch (err) {
      const isCancel = err && (err.name === 'RenderingCancelledException' || /cancel/i.test(err.message || ''));
      if (!isCancel) throw err;
    } finally {
      if (this._renderTask === task) this._renderTask = null;
    }
    return { canvas, scale: this._renderedScale };
  }
}
