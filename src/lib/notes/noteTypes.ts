/**
 * PDF note data model.
 *
 * A note is annotation metadata only — the PDF bytes are never stored.
 * `docId` is the stable PDF identifier (same key used by highlights /
 * recent files: `path:<abs-path>` under Tauri, `file:<name>:<size>` in
 * the browser). `docName` is denormalized so the Notes panel can render
 * without reopening the PDF.
 *
 * Positioning: `x` / `y` are stored in *scale-1 viewport coordinates*
 * (client pixels divided by capture-time zoom), the same convention as
 * highlights. The annotation layer projects them with a single
 * multiplication, so indicators stay aligned across zoom / resize.
 * For page notes the position defaults to the page corner; the indicator
 * is always offset so it never covers PDF text.
 */

export type NoteKind = "selection" | "page";

export interface PdfNote {
  /** Unique id, e.g. `note_<uuid>`. */
  id: string;
  /** Stable PDF identifier (see above). */
  docId: string;
  /** Human-readable PDF file name (for the Notes panel). */
  docName: string;
  /** 1-based page number the note is attached to. */
  page: number;
  kind: NoteKind;
  /** Quoted text for selection notes; "" for page notes. */
  selectedText: string;
  title: string;
  content: string;
  /** Scale-1 viewport position (see above). */
  x: number;
  y: number;
  /** Epoch millis. */
  createdAt: number;
  updatedAt: number;
}

export interface NewNoteInput {
  docId: string;
  docName: string;
  page: number;
  kind: NoteKind;
  selectedText?: string;
  title: string;
  content: string;
  x: number;
  y: number;
}

export interface NoteUpdate {
  title?: string;
  content?: string;
  page?: number;
  x?: number;
  y?: number;
  selectedText?: string;
}

export function createNoteId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `note_${crypto.randomUUID()}`;
  }
  return `note_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function isNoteKind(value: unknown): value is NoteKind {
  return value === "selection" || value === "page";
}

/** Short preview for the Notes panel list (single line, capped). */
export function notePreview(note: Pick<PdfNote, "content" | "selectedText">, max = 90): string {
  const source = note.content.trim() || note.selectedText.trim();
  if (!source) return "Empty note";
  const single = source.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function sanitizePage(page: unknown, fallback = 1): number {
  const n = typeof page === "number" ? page : Number(page);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}
