import { create } from "zustand";
import {
  DEFAULT_MARKUP_COLOR,
  DEFAULT_MARKUP_STROKE,
  type MarkupPoint,
} from "@/lib/annotations/markupTypes";

export type MarkupTool =
  | "select"
  | "underline"
  | "strike"
  | "freehand"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text";

/** Shape geometry captured while the pointer is down (scale-1 coords). */
export type MarkupDraft =
  | { kind: "rect" | "ellipse"; page: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "arrow"; page: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: "freehand"; page: number; points: MarkupPoint[] };

export interface MarkupEditorAnchor {
  x: number;
  y: number;
}

interface MarkupUiState {
  /** Active annotation tool (persistent until switched back to select). */
  tool: MarkupTool;
  color: string;
  stroke: number;

  /** Markup open in the editor popover (select mode clicks). */
  selectedId: string | null;
  editorAnchor: MarkupEditorAnchor | null;

  /** In-progress drawn shape (preview while dragging). */
  draft: MarkupDraft | null;
  /** Pending text placement (dialog open). */
  textDraft: { page: number; x: number; y: number } | null;

  setTool: (tool: MarkupTool) => void;
  setColor: (color: string) => void;
  setStroke: (stroke: number) => void;
  select: (id: string, anchor: MarkupEditorAnchor) => void;
  closeEditor: () => void;
  setDraft: (draft: MarkupDraft | null) => void;
  openTextDraft: (target: { page: number; x: number; y: number }) => void;
  closeTextDraft: () => void;
  closeAll: () => void;
}

export const useMarkupUi = create<MarkupUiState>()((set) => ({
  tool: "select",
  color: DEFAULT_MARKUP_COLOR,
  stroke: DEFAULT_MARKUP_STROKE,

  selectedId: null,
  editorAnchor: null,

  draft: null,
  textDraft: null,

  setTool: (tool) =>
    set({ tool, selectedId: null, editorAnchor: null, draft: null, textDraft: null }),
  setColor: (color) => set({ color }),
  setStroke: (stroke) => set({ stroke }),
  select: (id, anchor) =>
    set({ selectedId: id, editorAnchor: anchor, draft: null, textDraft: null }),
  closeEditor: () => set({ selectedId: null, editorAnchor: null }),
  setDraft: (draft) => set({ draft }),
  openTextDraft: (target) =>
    set({ textDraft: target, selectedId: null, editorAnchor: null, draft: null }),
  closeTextDraft: () => set({ textDraft: null }),
  closeAll: () =>
    set({ selectedId: null, editorAnchor: null, draft: null, textDraft: null }),
}));

/** Tools that draw with the pointer (suppress text selection while active). */
export function isDrawTool(tool: MarkupTool): tool is "freehand" | "rect" | "ellipse" | "arrow" | "text" {
  return (
    tool === "freehand" ||
    tool === "rect" ||
    tool === "ellipse" ||
    tool === "arrow" ||
    tool === "text"
  );
}

/** Tools that consume a text selection instead of pointer drawing. */
export function isTextMarkupTool(tool: MarkupTool): tool is "underline" | "strike" {
  return tool === "underline" || tool === "strike";
}
