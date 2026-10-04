/**
 * Freeform annotation (markup) data model.
 *
 * Covers the Batch 6 tools: underline, strikethrough, freehand drawing,
 * rectangle, circle (ellipse), arrow and text annotation.
 *
 * Positioning strategy (same convention as highlights and notes): every
 * coordinate is stored in *viewport coordinates at scale 1* (client pixels
 * divided by the capture-time zoom). Rendering projects with a single
 * multiplication (`stored * currentScale`), so markups stay aligned
 * across zoom, fit modes, resize and scrolling without re-derivation.
 * The overlay never touches the PDF bytes — the source file is unchanged.
 */

export type MarkupKind =
  | "underline"
  | "strike"
  | "freehand"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text";

/** One rectangle in scale-1 viewport coordinates. */
export interface MarkupQuad {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One pen point in scale-1 viewport coordinates. */
export interface MarkupPoint {
  x: number;
  y: number;
}

export interface MarkupColorDef {
  id: string;
  label: string;
  /** Hex swatch, stored verbatim on the markup. */
  swatch: string;
}

export const MARKUP_COLORS: MarkupColorDef[] = [
  { id: "red", label: "Red", swatch: "#E81123" },
  { id: "orange", label: "Orange", swatch: "#E86E2C" },
  { id: "yellow", label: "Yellow", swatch: "#C79E00" },
  { id: "green", label: "Green", swatch: "#1F9D55" },
  { id: "blue", label: "Blue", swatch: "#0F6CBD" },
  { id: "purple", label: "Purple", swatch: "#7B61FF" },
  { id: "black", label: "Black", swatch: "#1B1A19" },
];

export const DEFAULT_MARKUP_COLOR = "#E81123";
export const DEFAULT_MARKUP_STROKE = 2;
export const MARKUP_STROKES = [1.5, 2.5, 4];
export const DEFAULT_TEXT_SIZE = 14;
export const MAX_TEXT_LENGTH = 2000;

interface MarkupBase {
  id: string;
  /** Stable document key (same scheme as highlights/notes). */
  docId: string;
  /** 1-based page number. */
  page: number;
  kind: MarkupKind;
  /** Hex color (e.g. "#E81123"). */
  color: string;
  /** Line thickness in scale-1 px (ignored by text markups). */
  stroke: number;
  createdAt: number;
  updatedAt: number;
}

export interface UnderlineMarkup extends MarkupBase {
  kind: "underline";
  quads: MarkupQuad[];
  /** Quoted source text (display + future search). */
  text: string;
}

export interface StrikeMarkup extends MarkupBase {
  kind: "strike";
  quads: MarkupQuad[];
  text: string;
}

export interface FreehandMarkup extends MarkupBase {
  kind: "freehand";
  points: MarkupPoint[];
}

export interface RectMarkup extends MarkupBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EllipseMarkup extends MarkupBase {
  kind: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArrowMarkup extends MarkupBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextMarkup extends MarkupBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type Markup =
  | UnderlineMarkup
  | StrikeMarkup
  | FreehandMarkup
  | RectMarkup
  | EllipseMarkup
  | ArrowMarkup
  | TextMarkup;

export function isMarkupKind(value: unknown): value is MarkupKind {
  return (
    value === "underline" ||
    value === "strike" ||
    value === "freehand" ||
    value === "rect" ||
    value === "ellipse" ||
    value === "arrow" ||
    value === "text"
  );
}

export function isMarkupColorSwatch(value: unknown): value is string {
  return (
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
  );
}

export function createMarkupId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `mk_${crypto.randomUUID()}`;
  }
  return `mk_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
