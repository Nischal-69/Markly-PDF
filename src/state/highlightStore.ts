import { create } from "zustand";
import {
  createHighlightId,
  loadHighlights,
  persistHighlights,
} from "@/lib/annotations/highlightRepo";
import type {
  CapturedPageSelection,
  Highlight,
  HighlightColorId,
} from "@/lib/annotations/highlightTypes";

interface HighlightState {
  /** Document the loaded highlights belong to (null = none loaded). */
  docId: string | null;
  highlights: Highlight[];

  loadForDoc: (docId: string) => void;
  clear: () => void;
  /** Stores captured selections; returns the created highlights. */
  addCaptured: (
    docId: string,
    color: HighlightColorId,
    captured: CapturedPageSelection[],
  ) => Highlight[];
  updateColor: (id: string, color: HighlightColorId) => void;
  remove: (id: string) => void;
}

function order(list: Highlight[]): Highlight[] {
  return [...list].sort(
    (a, b) => a.page - b.page || a.createdAt - b.createdAt,
  );
}

export const useHighlightStore = create<HighlightState>()((set, get) => ({
  docId: null,
  highlights: [],

  loadForDoc: (docId: string) => {
    set({ docId, highlights: order(loadHighlights(docId)) });
  },

  clear: () => set({ docId: null, highlights: [] }),

  addCaptured: (docId, color, captured) => {
    if (captured.length === 0) return [];
    const now = Date.now();
    const created: Highlight[] = captured.map((c, index) => ({
      id: createHighlightId(),
      docId,
      page: c.page,
      text: c.text,
      color,
      range: c.range,
      quads: c.quads,
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const next = order([...get().highlights, ...created]);
    set({ docId, highlights: next });
    persistHighlights(docId, next);
    return created;
  },

  updateColor: (id, color) => {
    const { docId, highlights } = get();
    if (!docId) return;
    const next = highlights.map((h) =>
      h.id === id ? { ...h, color, updatedAt: Date.now() } : h,
    );
    set({ highlights: next });
    persistHighlights(docId, next);
  },

  remove: (id: string) => {
    const { docId, highlights } = get();
    if (!docId) return;
    const next = highlights.filter((h) => h.id !== id);
    set({ highlights: next });
    persistHighlights(docId, next);
  },
}));
