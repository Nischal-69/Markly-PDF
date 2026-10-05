import { ensurePdfWorker, pdfjsLib } from "./pdfjsSetup";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  PageViewport,
} from "pdfjs-dist";

export type PdfLoadErrorKind =
  | "missing"
  | "invalid"
  | "corrupted"
  | "password"
  | "empty"
  | "unknown";

/**
 * User-friendly PDF loading error. The UI shows `message`
 * (never raw PDF.js internals); `details` is kept for debugging.
 */
export class PdfLoadError extends Error {
  readonly kind: PdfLoadErrorKind;
  readonly details: string | null;

  constructor(kind: PdfLoadErrorKind, message: string, details?: string | null) {
    super(message);
    this.name = "PdfLoadError";
    this.kind = kind;
    this.details = details ?? null;
  }
}

function toPdfLoadError(raw: unknown): PdfLoadError {
  const name =
    typeof raw === "object" && raw !== null && "name" in raw
      ? String((raw as { name: unknown }).name)
      : "";
  const rawMessage = raw instanceof Error ? raw.message : String(raw);

  if (name === "PasswordException") {
    return new PdfLoadError(
      "password",
      "This PDF is password protected. Password-protected files are not supported yet.",
      rawMessage,
    );
  }
  if (name === "InvalidPDFException") {
    return new PdfLoadError(
      "invalid",
      "This file is not a valid PDF. Please choose a different file.",
      rawMessage,
    );
  }
  if (name === "MissingPDFException") {
    return new PdfLoadError(
      "missing",
      "The PDF file could not be found. It may have been moved or deleted.",
      rawMessage,
    );
  }
  return new PdfLoadError(
    "corrupted",
    "This PDF could not be opened. The file may be corrupted or incomplete.",
    rawMessage,
  );
}

// ---------------------------------------------------------------------------
// Document lifecycle. A single document is held at a time; the proxy is kept
// OUTSIDE React state so page navigation never triggers document reloads.
// ---------------------------------------------------------------------------

let currentDoc: PDFDocumentProxy | null = null;
let currentKey: string | null = null;
let loadGeneration = 0;
/** Original file bytes, retained so "Save a copy" needs no re-read. */
let originalBytes: Uint8Array | null = null;

export function getLoadedDocument(): PDFDocumentProxy | null {
  return currentDoc;
}

export function getOriginalBytes(): Uint8Array | null {
  return originalBytes;
}

export async function closePdfDocument(): Promise<void> {
  loadGeneration += 1;
  const doc = currentDoc;
  currentDoc = null;
  currentKey = null;
  originalBytes = null;
  if (doc) {
    try {
      await doc.destroy();
    } catch {
      // Destroy is best-effort; a new document load must still work.
    }
  }
}

/**
 * Loads a PDF from an in-memory buffer. `key` identifies the document
 * (path or generated id); loading the same key twice reuses nothing —
 * it always parses fresh so "open again" is reliable.
 */
export async function loadPdfDocument(
  data: ArrayBuffer,
  key: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<PDFDocumentProxy> {
  ensurePdfWorker();
  const generation = ++loadGeneration;

  // Memory: keep a view onto the caller's buffer for the retained
  // original, and hand PDF.js a single detachable copy. (An earlier
  // revision copied twice — 3× resident memory for large files.)
  // PDF.js may transfer (detach) the buffer it is given, so the two
  // must never be the same ArrayBuffer.
  const bytes = new Uint8Array(data);

  let doc: PDFDocumentProxy;
  try {
    const task = pdfjsLib.getDocument({
      data: data.slice(0),
      cMapUrl: undefined,
      cMapPacked: false,
      useSystemFonts: true,
    });
    if (onProgress) {
      task.onProgress = (progress: { loaded: number; total: number }) => {
        if (generation === loadGeneration) {
          onProgress(progress.loaded, progress.total);
        }
      };
    }
    doc = await task.promise;
  } catch (raw) {
    throw toPdfLoadError(raw);
  }

  // A newer load started while we were parsing — discard this one.
  if (generation !== loadGeneration) {
    void doc.destroy().catch(() => undefined);
    throw new PdfLoadError("unknown", "A newer document was opened.", null);
  }

  if (!doc || doc.numPages < 1) {
    void doc?.destroy().catch(() => undefined);
    throw new PdfLoadError(
      "empty",
      "This PDF has no pages to display.",
      null,
    );
  }

  // Replace the previously held document, if any.
  const previous = currentDoc;
  currentDoc = doc;
  currentKey = key;
  originalBytes = bytes;
  if (previous && previous !== doc) {
    void previous.destroy().catch(() => undefined);
  }
  return doc;
}

export function getCurrentKey(): string | null {
  return currentKey;
}

export async function getPage(pageNumber: number): Promise<PDFPageProxy> {
  if (!currentDoc) throw new Error("No PDF document is loaded.");
  return currentDoc.getPage(pageNumber);
}

// ---------------------------------------------------------------------------
// Page measuring. Every PdfPage measures itself on mount so scroll geometry
// is exact before anything paints. On a 100+ page document that fires all at
// once and floods the worker while first paint is still pending, so fetches
// go through a small concurrency queue. Waiters hold no resources and bail
// out early when the document changed (or closed) underneath them.
// ---------------------------------------------------------------------------

const DIM_CONCURRENCY = 6;

let dimInFlight = 0;
const dimQueue: Array<() => void> = [];

function pumpDimQueue(): void {
  while (dimInFlight < DIM_CONCURRENCY && dimQueue.length > 0) {
    const run = dimQueue.shift();
    if (!run) break;
    dimInFlight += 1;
    run();
  }
}

/** Page size in PDF points at scale 1 (cheap: no rendering involved). */
export async function getPageDimensions(
  pageNumber: number,
): Promise<{ width: number; height: number }> {
  const keyAtCall = currentKey;
  const generationAtCall = loadGeneration;

  // Wait for a fetch slot. A document switch/close while queued rejects
  // so stale callers fall back instead of doing wasted work.
  await new Promise<void>((resolve, reject) => {
    const run = () => {
      if (keyAtCall !== currentKey || generationAtCall !== loadGeneration) {
        dimInFlight = Math.max(0, dimInFlight - 1);
        pumpDimQueue();
        reject(new Error("Document changed while measuring."));
        return;
      }
      resolve();
    };
    dimQueue.push(run);
    pumpDimQueue();
  });

  try {
    const page = await getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    } finally {
      page.cleanup();
    }
  } finally {
    dimInFlight = Math.max(0, dimInFlight - 1);
    pumpDimQueue();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderedViewport {
  viewport: PageViewport;
  cssWidth: number;
  cssHeight: number;
}

/**
 * Upper bound on single-canvas device pixels (~4096×4096, ≈64MB RGBA).
 * Without it, max zoom on a large page allocates 100MB+ bitmaps and can
 * crash the tab; normal zoom levels never come close to the cap.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Renders a page onto `canvas` at the given scale, honouring the device
 * pixel ratio (capped) so output stays crisp without exploding memory.
 * Returns the active render task so callers can cancel on unmount/zoom.
 */
export function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  maxDpr = 2,
): { task: RenderTask; viewport: PageViewport } {
  const viewport = page.getViewport({ scale });
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

  // Shrink the effective DPR (never the CSS size) when the bitmap would
  // exceed the pixel budget — e.g. 4× zoom on an A4 page.
  const devicePixels = viewport.width * dpr * (viewport.height * dpr);
  if (devicePixels > MAX_CANVAS_PIXELS && devicePixels > 0) {
    dpr *= Math.sqrt(MAX_CANVAS_PIXELS / devicePixels);
  }

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context is not available.");

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // NOTE (pdfjs-dist v5): when `canvas` is provided, a caller-supplied
  // `canvasContext` is ignored — so we pass the canvas through the context
  // (canvas: null) to keep our DPR transform.
  const task = page.render({ canvas: null, canvasContext: ctx, viewport });
  return { task, viewport };
}

/**
 * Renders a small thumbnail of a page. No text layer — thumbnails are
 * purely visual and rendered at low resolution on purpose.
 */
export function renderThumbnailToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): { task: RenderTask; height: number } {
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = "100%";
  canvas.style.height = "auto";

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context is not available.");

  const task = page.render({ canvas: null, canvasContext: ctx, viewport });
  return { task, height: viewport.height };
}
