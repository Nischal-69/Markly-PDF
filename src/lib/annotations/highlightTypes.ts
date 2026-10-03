/**
 * Highlight data model.
 *
 * Positioning strategy: quads are stored in *viewport coordinates at
 * scale 1* (i.e. client pixels divided by the capture-time zoom). Both
 * capture and rendering go through the same PDF.js viewport mapping, so
 * quads stay correct across zoom, fit modes, window resize and scrolling
 * by a single multiplication — no re-derivation, no screen coordinates.
 *
 * The text range (div indices into the PDF.js text layer + char offsets)
 * is stored alongside for identification, future re-anchoring and search
 * integration. Quads are the source of truth for rendering.
 */

export type HighlightColorId =
  | "yellow"
  | "green"
  | "blue"
  | "orange"
  | "pink"
  | "purple";

export interface HighlightColorDef {
  id: HighlightColorId;
  label: string;
  /** Solid swatch for toolbar dots / active states. */
  swatch: string;
}

export const HIGHLIGHT_COLORS: HighlightColorDef[] = [
  { id: "yellow", label: "Yellow", swatch: "#F5C518" },
  { id: "green", label: "Green", swatch: "#35B558" },
  { id: "blue", label: "Blue", swatch: "#2E9BF0" },
  { id: "orange", label: "Orange", swatch: "#F08A24" },
  { id: "pink", label: "Pink", swatch: "#E85D9E" },
  { id: "purple", label: "Purple", swatch: "#9B6BF0" },
];

/** One rectangle in scale-1 viewport coordinates. */
export interface HighlightQuad {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Text-layer anchor: span index (data-div-index) + char offset. */
export interface HighlightRange {
  beginDiv: number;
  beginOffset: number;
  endDiv: number;
  endOffset: number;
}

export interface Highlight {
  id: string;
  /** Stable document key (path-based under Tauri, name+size in browser). */
  docId: string;
  page: number;
  /** Human-readable selected text (display + verification). */
  text: string;
  color: HighlightColorId;
  range: HighlightRange;
  quads: HighlightQuad[];
  createdAt: number;
  updatedAt: number;
}

/** A freshly captured selection, before id/timestamps are assigned. */
export interface CapturedPageSelection {
  page: number;
  text: string;
  range: HighlightRange;
  quads: HighlightQuad[];
}

export function isHighlightColorId(value: unknown): value is HighlightColorId {
  return (
    typeof value === "string" &&
    HIGHLIGHT_COLORS.some((c) => c.id === value)
  );
}
