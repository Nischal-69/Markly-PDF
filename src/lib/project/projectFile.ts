/**
 * Batch 8 — Markly project file (.markly.json).
 *
 * A project is overlay metadata ONLY (highlights, markups, notes,
 * bookmarks + source identity). PDF bytes are never embedded — the file
 * stays small and the original PDF is never touched.
 *
 * Save = write to the known project path (or fall back to Save As).
 * Save As = always ask for a location, then remember it.
 * Export PDF is separate (see lib/export/pdfExport.ts).
 */

import type { Highlight } from "@/lib/annotations/highlightTypes";
import type { Markup } from "@/lib/annotations/markupTypes";
import type { PdfNote } from "@/lib/notes/noteTypes";
import type { Bookmark } from "@/lib/bookmarks/bookmarkRepo";

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".markly.json";

export interface MarklyProject {
  app: "markly-pdf";
  version: number;
  docId: string;
  docName: string;
  /** Original PDF path when known (Tauri); null in the browser. */
  sourcePath: string | null;
  sourceSize: number | null;
  numPages: number;
  savedAt: number;
  highlights: Highlight[];
  markups: Markup[];
  notes: PdfNote[];
  bookmarks: Bookmark[];
}

export function serializeProject(project: MarklyProject): string {
  return JSON.stringify(project, null, 2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Validates an imported project file. Returns null for anything that
 * is not a Markly project (wrong app, version, shapes). Arrays are
 * passed through as-is — callers sanitize via the existing repos when
 * applying them.
 */
export function parseProject(raw: string): MarklyProject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.app !== "markly-pdf") return null;
  if (typeof parsed.version !== "number" || parsed.version < 1) return null;
  if (typeof parsed.docId !== "string" || !parsed.docId) return null;
  if (typeof parsed.docName !== "string" || !parsed.docName) return null;
  if (
    !Array.isArray(parsed.highlights) ||
    !Array.isArray(parsed.markups) ||
    !Array.isArray(parsed.notes) ||
    !Array.isArray(parsed.bookmarks)
  ) {
    return null;
  }
  return {
    app: "markly-pdf",
    version: parsed.version,
    docId: parsed.docId,
    docName: parsed.docName,
    sourcePath: typeof parsed.sourcePath === "string" ? parsed.sourcePath : null,
    sourceSize: typeof parsed.sourceSize === "number" ? parsed.sourceSize : null,
    numPages: typeof parsed.numPages === "number" ? parsed.numPages : 0,
    savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    highlights: parsed.highlights as Highlight[],
    markups: parsed.markups as Markup[],
    notes: parsed.notes as PdfNote[],
    bookmarks: parsed.bookmarks as Bookmark[],
  };
}
