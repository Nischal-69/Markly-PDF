import { create } from "zustand";
import type { CapturedPageSelection } from "@/lib/annotations/highlightTypes";

export interface SelectionAnchor {
  x: number;
  y: number;
  /** Above the selection when true, below it when space is tight. */
  above: boolean;
}

export interface PendingSelection {
  pages: CapturedPageSelection[];
  anchor: SelectionAnchor;
}

export interface EditorTarget {
  highlightId: string;
  x: number;
  y: number;
}

interface HighlightUiState {
  /** Captured selection awaiting a color choice (toolbar visible). */
  pending: PendingSelection | null;
  /** Existing highlight being edited (popover visible). */
  editor: EditorTarget | null;

  showSelection: (pages: CapturedPageSelection[], anchor: SelectionAnchor) => void;
  moveSelectionAnchor: (anchor: SelectionAnchor) => void;
  hideSelection: () => void;
  openEditor: (target: EditorTarget) => void;
  closeEditor: () => void;
  closeAll: () => void;
}

export const useHighlightUi = create<HighlightUiState>()((set) => ({
  pending: null,
  editor: null,

  showSelection: (pages, anchor) =>
    set({ pending: { pages, anchor }, editor: null }),
  moveSelectionAnchor: (anchor) =>
    set((s) => (s.pending ? { pending: { ...s.pending, anchor } } : s)),
  hideSelection: () => set({ pending: null }),
  openEditor: (target) => set({ editor: target, pending: null }),
  closeEditor: () => set({ editor: null }),
  closeAll: () => set({ pending: null, editor: null }),
}));

/** Toolbar anchor from a client rect, clamped inside the viewport. */
export function anchorFromRect(rect: DOMRect): SelectionAnchor {
  const margin = 12;
  const x = Math.min(
    Math.max(rect.left + rect.width / 2, 120),
    window.innerWidth - 120,
  );
  const above = rect.top > 96;
  const y = above
    ? Math.max(rect.top - 10, margin)
    : Math.min(rect.bottom + 10, window.innerHeight - margin);
  return { x, y, above };
}
