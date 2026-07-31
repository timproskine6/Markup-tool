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
