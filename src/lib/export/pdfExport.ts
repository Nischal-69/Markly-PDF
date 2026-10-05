/**
 * Batch 8 — annotated PDF export engine.
 *
 * Burns Markly overlays (highlights, underline/strikethrough, drawings,
 * shapes, text annotations, notes) into a copy of the original PDF bytes
 * using pdf-lib, so the result opens in Markly AND any other PDF reader.
 *
 * The original file is never mutated: callers pass the loaded bytes and
 * receive brand-new bytes to write to a user-chosen location.
 *
 * Coordinate mapping: overlays are stored in scale-1 viewport space
 * (CSS px at zoom 1). Each page's pdf.js viewport (scale 1) is paired
 * with the matching pdf-lib page size to convert to PDF points
 * (origin bottom-left). `viewport.convertToPdfPoint` is preferred so
 * rotated pages stay correct; a manual Y-flip fallback covers older
 * pdf.js builds.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getPage } from "@/lib/pdf/pdfEngine";
import { HIGHLIGHT_COLORS, type Highlight } from "@/lib/annotations/highlightTypes";
import type { Markup } from "@/lib/annotations/markupTypes";
import type { PdfNote } from "@/lib/notes/noteTypes";

export interface ExportAnnotations {
  highlights: Highlight[];
  markups: Markup[];
  notes: PdfNote[];
}

export interface ExportProgress {
  /** load = parsing source, render = burning pages, save = serializing. */
  phase: "load" | "render" | "save";
  page: number;
  totalPages: number;
  /** 0..1 overall. */
  ratio: number;
}

export class PdfExportError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts as ErrorOptions);
    this.name = "PdfExportError";
  }
}

const HIGHLIGHT_HEX = new Map(HIGHLIGHT_COLORS.map((c) => [c.id, c.swatch]));

function hexToRgbTuple(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return [0.96, 0.77, 0.09]; // fallback yellow
  const v = Number.parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function pdfColor(hex: string) {
  const [r, g, b] = hexToRgbTuple(hex);
  return rgb(r, g, b);
}

/** Standard-font safe: strip lone surrogates; pdf-lib WinAnsi covers Latin. */
function safeText(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "").slice(0, 2000);
}

function wrapLines(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      if (w.length > maxChars) {
        // Hard-break very long tokens.
        for (let i = 0; i < w.length; i += maxChars) {
          lines.push(w.slice(i, i + maxChars));
        }
        cur = "";
      } else {
        cur = w;
      }
    } else {
      cur = next;
    }
    if (lines.length >= 24) break;
  }
  if (cur && lines.length < 24) lines.push(cur);
  return lines.slice(0, 24);
}

interface PageMapping {
  viewportWidth: number;
  viewportHeight: number;
  pdfWidth: number;
  pdfHeight: number;
  scaleAvg: number;
  toPdf: (x: number, y: number) => { x: number; y: number };
  toPdfRect: (left: number, top: number, width: number, height: number) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

function makeMapping(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewport: any,
  pdfWidth: number,
  pdfHeight: number,
): PageMapping {
  const viewportWidth = Number(viewport?.width) || pdfWidth;
  const viewportHeight = Number(viewport?.height) || pdfHeight;
  const sx = viewportWidth > 0 ? pdfWidth / viewportWidth : 1;
  const sy = viewportHeight > 0 ? pdfHeight / viewportHeight : 1;
  const scaleAvg = (sx + sy) / 2;
  const convert = viewport?.convertToPdfPoint?.bind(viewport) as
    | ((x: number, y: number) => [number, number])
    | undefined;

  const toPdf = (x: number, y: number) => {
    if (convert) {
      try {
        const [px, py] = convert(x, y);
        if (Number.isFinite(px) && Number.isFinite(py)) return { x: px, y: py };
      } catch {
        // fall through to manual flip
      }
    }
    return { x: x * sx, y: pdfHeight - y * sy };
  };

  const toPdfRect = (left: number, top: number, width: number, height: number) => {
    const a = toPdf(left, top);
    const b = toPdf(left + width, top + height);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  };

  return { viewportWidth, viewportHeight, pdfWidth, pdfHeight, scaleAvg, toPdf, toPdfRect };
}

function drawHighlightQuad(
  page: PDFPage,
  map: PageMapping,
  hex: string,
  quad: { left: number; top: number; width: number; height: number },
): void {
  if (!(quad.width > 0 && quad.height > 0)) return;
  const r = map.toPdfRect(quad.left, quad.top, quad.width, quad.height);
  if (!(r.width > 0.5 && r.height > 0.5)) return;
  page.drawRectangle({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    color: pdfColor(hex),
    opacity: 0.35,
    borderWidth: 0,
  });
}

function drawLineMarkup(
  page: PDFPage,
  map: PageMapping,
  hex: string,
  stroke: number,
  quad: { left: number; top: number; width: number; height: number },
  kind: "underline" | "strike",
): void {
  const yView = kind === "underline" ? quad.top + quad.height - 1.2 : quad.top + quad.height / 2;
  const a = map.toPdf(quad.left, yView);
  const b = map.toPdf(quad.left + quad.width, yView);
  page.drawLine({
    start: a,
    end: b,
    thickness: Math.max(0.75, stroke * map.scaleAvg * (kind === "strike" ? 0.8 : 1)),
    color: pdfColor(hex),
    opacity: 0.95,
  });
}

function drawFreehand(
  page: PDFPage,
  map: PageMapping,
  hex: string,
  stroke: number,
  points: Array<{ x: number; y: number }>,
): void {
  const thickness = Math.max(0.75, stroke * map.scaleAvg);
  const color = pdfColor(hex);
  for (let i = 1; i < points.length; i += 1) {
    const a = map.toPdf(points[i - 1].x, points[i - 1].y);
    const b = map.toPdf(points[i].x, points[i].y);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    // Skip zero-length joints (dense mouse samples).
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) continue;
    page.drawLine({ start: a, end: b, thickness, color, opacity: 1 });
  }
}

function drawArrow(
  page: PDFPage,
  map: PageMapping,
  hex: string,
  stroke: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const p1 = map.toPdf(x1, y1);
  const p2 = map.toPdf(x2, y2);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1)) return;
  const color = pdfColor(hex);
  const thickness = Math.max(0.75, stroke * map.scaleAvg);
  const ux = dx / len;
  const uy = dy / len;
  const headLen = (10 + stroke * 2.2) * map.scaleAvg;
  const headW = (7 + stroke * 1.8) * map.scaleAvg;
  const bx = p2.x - ux * headLen;
  const by = p2.y - uy * headLen;
  const w1 = { x: bx - uy * headW * 0.5, y: by + ux * headW * 0.5 };
  const w2 = { x: bx + uy * headW * 0.5, y: by - ux * headW * 0.5 };
  page.drawLine({ start: p1, end: { x: bx, y: by }, thickness, color, opacity: 1 });
  page.drawLine({ start: p2, end: w1, thickness, color, opacity: 1 });
  page.drawLine({ start: p2, end: w2, thickness, color, opacity: 1 });
  page.drawLine({ start: w1, end: w2, thickness: Math.max(0.5, thickness * 0.7), color, opacity: 1 });
}

function drawWrappedNote(
  page: PDFPage,
  map: PageMapping,
  font: PDFFont,
  bold: PDFFont,
  anchorView: { x: number; y: number },
  title: string,
  body: string,
  accentHex: string,
  isPageNote: boolean,
): void {
  // Page-corner notes live at (0,0) in viewport space — export them as a
  // top-right callout so they never cover content in other readers.
  const view = isPageNote ? { x: map.viewportWidth - 190, y: 12 } : anchorView;
  const anchor = map.toPdf(view.x, view.y);
  const boxW = 170;
  const titleLines = wrapLines(safeText(title) || "Note", 32);
  const bodyLines = wrapLines(safeText(body), 38).slice(0, 12);
  const lineH = 10;
  const boxH = 18 + (titleLines.length + bodyLines.length) * lineH + 10;
  // Clamp inside the page.
  let boxX = Math.min(Math.max(anchor.x + 8, 8), Math.max(8, map.pdfWidth - boxW - 8));
  let boxY = Math.min(Math.max(anchor.y - boxH - 6, 8), Math.max(8, map.pdfHeight - boxH - 8));
  if (![boxX, boxY].every(Number.isFinite)) return;

  // Pin marker at the anchor.
  const pinR = map.toPdfRect(view.x - 1, view.y - 1, 12, 12);
  page.drawRectangle({
    x: pinR.x,
    y: pinR.y,
    width: Math.max(8, pinR.width),
    height: Math.max(8, pinR.height),
    color: pdfColor(accentHex),
    borderColor: pdfColor("#1B1A19"),
    borderWidth: 0.75,
    opacity: 1,
  });

  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    color: rgb(1, 0.988, 0.78),
    borderColor: pdfColor(accentHex),
    borderWidth: 1,
    opacity: 1,
  });
  // Accent bar like the on-screen card.
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: 4,
    height: boxH,
    color: pdfColor(accentHex),
    borderWidth: 0,
    opacity: 1,
  });

  let cursorY = boxY + boxH - 14;
  for (const line of titleLines) {
    try {
      page.drawText(line, { x: boxX + 10, y: cursorY, size: 8.5, font: bold, color: rgb(0.11, 0.1, 0.1) });
    } catch {
      // Unsupported glyphs must never fail the whole export.
    }
    cursorY -= lineH;
  }
  for (const line of bodyLines) {
    try {
      page.drawText(line, { x: boxX + 10, y: cursorY, size: 7.5, font, color: rgb(0.25, 0.24, 0.23) });
    } catch {
      // Skip undecodable lines.
    }
    cursorY -= lineH;
  }
}

/**
 * Burns overlays into a copy of `original` and returns the new PDF bytes.
 * Progress is reported per page so large PDFs show a live indicator.
 * Throws PdfExportError with a user-facing message on failure.
 */
export async function exportAnnotatedPdf(
  original: Uint8Array,
  annotations: ExportAnnotations,
  onProgress?: (p: ExportProgress) => void,
): Promise<Uint8Array> {
  const report = (p: ExportProgress) => {
    try {
      onProgress?.(p);
    } catch {
      // Progress listeners must never break the export.
    }
  };

  let doc: PDFDocument;
  try {
    report({ phase: "load", page: 0, totalPages: 1, ratio: 0 });
    // Slice: pdf-lib must own its buffer (the engine retains the original).
    const owned = new Uint8Array(original).slice();
    doc = await PDFDocument.load(owned, { ignoreEncryption: false });
  } catch (raw) {
    const msg = raw instanceof Error ? raw.message : String(raw);
    if (/encrypt|password/i.test(msg)) {
      throw new PdfExportError("This PDF is password protected and cannot be exported.");
    }
    throw new PdfExportError("The PDF could not be read for export. It may be corrupted.", { cause: raw });
  }

  let font: PDFFont;
  let bold: PDFFont;
  try {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  } catch (raw) {
    throw new PdfExportError("The PDF exporter could not load fonts.", { cause: raw });
  }

  const pages = doc.getPages();
  const totalPages = pages.length;
  if (totalPages < 1) throw new PdfExportError("This PDF has no pages to export.");

  const byPage = new Map<number, { highlights: Highlight[]; markups: Markup[]; notes: PdfNote[] }>();
  const ensure = (page: number) => {
    let e = byPage.get(page);
    if (!e) {
      e = { highlights: [], markups: [], notes: [] };
      byPage.set(page, e);
    }
    return e;
  };
  for (const h of annotations.highlights) {
    if (h.page >= 1 && h.page <= totalPages) ensure(h.page).highlights.push(h);
  }
  for (const m of annotations.markups) {
    if (m.page >= 1 && m.page <= totalPages) ensure(m.page).markups.push(m);
  }
  for (const n of annotations.notes) {
    if (n.page >= 1 && n.page <= totalPages) ensure(n.page).notes.push(n);
  }

  try {
    for (let i = 0; i < pages.length; i += 1) {
      const pageNum = i + 1;
      const pdfPage = pages[i];
      const entry = byPage.get(pageNum);
      if (entry && (entry.highlights.length + entry.markups.length + entry.notes.length > 0)) {
        // Viewport at scale 1 for this page (handles zoom-free mapping).
        let viewport: unknown = null;
        let pdfJsPage: { getViewport: (o: { scale: number }) => unknown; cleanup: () => void } | null = null;
        try {
          const live = (await getPage(pageNum)) as unknown as {
            getViewport: (o: { scale: number }) => unknown;
            cleanup: () => void;
          };
          pdfJsPage = live;
          viewport = live.getViewport({ scale: 1 });
        } catch {
          viewport = null;
        }
        try {
          const { width: pdfW, height: pdfH } = pdfPage.getSize();
          const map = makeMapping(viewport, pdfW, pdfH);

          for (const h of entry.highlights) {
            const hex = HIGHLIGHT_HEX.get(h.color) ?? "#F5C518";
            for (const q of h.quads) {
              try {
                drawHighlightQuad(pdfPage, map, hex, q);
              } catch {
                // One bad quad must not fail the export.
              }
            }
          }

          for (const m of entry.markups) {
            try {
              switch (m.kind) {
                case "underline":
                case "strike":
                  for (const q of m.quads) drawLineMarkup(pdfPage, map, m.color, m.stroke, q, m.kind);
                  break;
                case "rect": {
                  const r = map.toPdfRect(m.x, m.y, m.w, m.h);
                  pdfPage.drawRectangle({
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    borderColor: pdfColor(m.color),
                    borderWidth: Math.max(0.5, m.stroke * map.scaleAvg),
                    opacity: 0,
                    borderOpacity: 1,
                  });
                  break;
                }
                case "ellipse": {
                  const r = map.toPdfRect(m.x, m.y, m.w, m.h);
                  pdfPage.drawEllipse({
                    x: r.x + r.width / 2,
                    y: r.y + r.height / 2,
                    xScale: Math.max(0.5, r.width / 2),
                    yScale: Math.max(0.5, r.height / 2),
                    borderColor: pdfColor(m.color),
                    borderWidth: Math.max(0.5, m.stroke * map.scaleAvg),
                    opacity: 0,
                    borderOpacity: 1,
                  });
                  break;
                }
                case "arrow":
                  drawArrow(pdfPage, map, m.color, m.stroke, m.x1, m.y1, m.x2, m.y2);
                  break;
                case "freehand":
                  drawFreehand(pdfPage, map, m.color, m.stroke, m.points);
                  break;
                case "text": {
                  const p = map.toPdf(m.x, m.y);
                  const sizePdf = Math.min(72, Math.max(6, m.fontSize * map.scaleAvg));
                  const accent = map.toPdfRect(m.x - 3, m.y - 2, 3, sizePdf + 6);
                  pdfPage.drawRectangle({
                    x: accent.x,
                    y: accent.y,
                    width: Math.max(1.5, accent.width),
                    height: accent.height,
                    color: pdfColor(m.color),
                    borderWidth: 0,
                    opacity: 1,
                  });
                  const lines = wrapLines(safeText(m.text), 48);
                  let cursorY = p.y - 2;
                  for (const line of lines.slice(0, 12)) {
                    try {
                      pdfPage.drawText(line, {
                        x: p.x + 4,
                        y: cursorY,
                        size: sizePdf,
                        font,
                        color: pdfColor("#1B1A19"),
                      });
                    } catch {
                      // Skip undecodable lines.
                    }
                    cursorY -= sizePdf * 1.2;
                  }
                  break;
                }
              }
            } catch {
              // One bad markup must not fail the export.
            }
          }

          for (const n of entry.notes) {
            try {
              const isPageNote = n.kind === "page" && n.x === 0 && n.y === 0;
              drawWrappedNote(
                pdfPage,
                map,
                font,
                bold,
                { x: n.x, y: n.y },
                n.title,
                n.content || n.selectedText,
                "#0F6CBD",
                isPageNote,
              );
            } catch {
              // Skip undecodable notes.
            }
          }
        } finally {
          try {
            pdfJsPage?.cleanup();
          } catch {
            // Best effort.
          }
        }
      }

      report({ phase: "render", page: pageNum, totalPages, ratio: pageNum / Math.max(1, totalPages) * 0.9 });
      // Yield so the progress bar paints on large PDFs (120+ pages).
      if (pageNum % 4 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }
  } catch (raw) {
    if (raw instanceof PdfExportError) throw raw;
    throw new PdfExportError("Annotations could not be drawn. Please try again.", { cause: raw });
  }

  try {
    report({ phase: "save", page: totalPages, totalPages, ratio: 0.95 });
    doc.setProducer("Markly PDF");
    doc.setCreator("Markly PDF");
    const bytes = await doc.save();
    report({ phase: "save", page: totalPages, totalPages, ratio: 1 });
    return new Uint8Array(bytes);
  } catch (raw) {
    throw new PdfExportError("The annotated PDF could not be saved. Please try again.", { cause: raw });
  }
}

/** Suggested export name: `report.pdf` → `report-annotated.pdf`. */
export function defaultExportName(fileName: string): string {
  const base = (fileName || "document.pdf").trim() || "document.pdf";
  const withoutExt = base.toLowerCase().endsWith(".pdf") ? base.slice(0, -4) : base;
  const clean = withoutExt.trim() || "document";
  return `${clean}-annotated.pdf`;
}

/** Suggested project name: `report.pdf` → `report.markly.json`. */
export function defaultProjectName(fileName: string): string {
  const base = (fileName || "document").trim() || "document";
  const withoutExt = base.toLowerCase().endsWith(".pdf") ? base.slice(0, -4) : base;
  return `${withoutExt.trim() || "document"}.markly.json`;
}
