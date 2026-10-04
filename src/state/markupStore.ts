import { create } from "zustand";
import { loadMarkups, persistMarkups } from "@/lib/annotations/markupRepo";
import {
  DEFAULT_MARKUP_COLOR,
  DEFAULT_MARKUP_STROKE,
  DEFAULT_TEXT_SIZE,
  MAX_TEXT_LENGTH,
  createMarkupId,
  type Markup,
  type MarkupKind,
  type MarkupPoint,
} from "@/lib/annotations/markupTypes";
import type { CapturedPageSelection } from "@/lib/annotations/highlightTypes";

export interface ShapeInput {
  kind: "rect" | "ellipse";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArrowInput {
  kind: "arrow";
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FreehandInput {
  kind: "freehand";
  page: number;
  points: MarkupPoint[];
}

export interface TextInput {
  kind: "text";
  page: number;
  x: number;
  y: number;
  text: string;
  fontSize?: number;
}

export type MarkupShapeInput = ShapeInput | ArrowInput | FreehandInput | TextInput;

export interface MarkupStylePatch {
  color?: string;
  stroke?: number;
}

interface MarkupState {
  /** Document the loaded markups belong to (null = none loaded). */
  docId: string | null;
  markups: Markup[];

  loadForDoc: (docId: string) => void;
  clear: () => void;
  /** Stores text-based markups (underline / strikethrough) from a selection. */
  addFromSelection: (
    docId: string,
    kind: "underline" | "strike",
    color: string,
    stroke: number,
    captured: CapturedPageSelection[],
  ) => Markup[];
  /** Stores one drawn/typed markup; returns it, or null when invalid. */
  addShape: (
    docId: string,
    input: MarkupShapeInput,
    style?: { color?: string; stroke?: number },
  ) => Markup | null;
  updateStyle: (id: string, patch: MarkupStylePatch) => void;
  updateText: (id: string, text: string) => void;
  remove: (id: string) => void;
  markupsForPage: (page: number) => Markup[];
}

function order(list: Markup[]): Markup[] {
  return [...list].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

function clampColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_MARKUP_COLOR;
}

function clampStroke(stroke: number): number {
  if (!Number.isFinite(stroke)) return DEFAULT_MARKUP_STROKE;
  return Math.min(12, Math.max(0.5, stroke));
}

function validShape(input: MarkupShapeInput): boolean {
  switch (input.kind) {
    case "rect":
    case "ellipse":
      return (
        Number.isFinite(input.x) &&
        Number.isFinite(input.y) &&
        input.w >= 6 &&
        input.h >= 6
      );
    case "arrow": {
      const dx = input.x2 - input.x1;
      const dy = input.y2 - input.y1;
      return Math.hypot(dx, dy) >= 8;
    }
    case "freehand":
      return input.points.length >= 2;
    case "text":
      return input.text.trim().length > 0;
  }
}

export const useMarkupStore = create<MarkupState>()((set, get) => ({
  docId: null,
  markups: [],

  loadForDoc: (docId: string) => {
    set({ docId, markups: order(loadMarkups(docId)) });
  },

  clear: () => set({ docId: null, markups: [] }),

  addFromSelection: (docId, kind, color, stroke, captured) => {
    if (captured.length === 0) return [];
    const now = Date.now();
    const created: Markup[] = captured.map((c, index) => ({
      id: createMarkupId(),
      docId,
      page: c.page,
      kind,
      color: clampColor(color),
      stroke: clampStroke(stroke),
      quads: c.quads,
      text: c.text.slice(0, 2000),
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const next = order([...get().markups, ...created]);
    set({ docId, markups: next });
    persistMarkups(docId, next);
    return created;
  },

  addShape: (docId, input, style) => {
    if (!validShape(input)) return null;
    const now = Date.now();
    const base = {
      id: createMarkupId(),
      docId,
      page: input.page,
      color: clampColor(style?.color ?? DEFAULT_MARKUP_COLOR),
      stroke: clampStroke(style?.stroke ?? DEFAULT_MARKUP_STROKE),
      createdAt: now,
      updatedAt: now,
    };
    let created: Markup;
    switch (input.kind) {
      case "rect":
      case "ellipse":
        created = { ...base, kind: input.kind, x: input.x, y: input.y, w: input.w, h: input.h };
        break;
      case "arrow":
        created = {
          ...base,
          kind: "arrow",
          x1: input.x1,
          y1: input.y1,
          x2: input.x2,
          y2: input.y2,
        };
        break;
      case "freehand":
        created = { ...base, kind: "freehand", points: input.points };
        break;
      case "text":
        created = {
          ...base,
          kind: "text",
          x: input.x,
          y: input.y,
          text: input.text.trim().slice(0, MAX_TEXT_LENGTH),
          fontSize:
            input.fontSize && Number.isFinite(input.fontSize) ?
              Math.min(72, Math.max(8, input.fontSize))
            : DEFAULT_TEXT_SIZE,
        };
        break;
    }
    const next = order([...get().markups, created]);
    set({ docId, markups: next });
    persistMarkups(docId, next);
    return created;
  },

  updateStyle: (id, patch) => {
    const { docId, markups } = get();
    if (!docId) return;
    const next = markups.map((m) => {
      if (m.id !== id) return m;
      return {
        ...m,
        color: patch.color !== undefined ? clampColor(patch.color) : m.color,
        stroke: patch.stroke !== undefined ? clampStroke(patch.stroke) : m.stroke,
        updatedAt: Date.now(),
      };
    });
    set({ markups: next });
    persistMarkups(docId, next);
  },

  updateText: (id, text) => {
    const { docId, markups } = get();
    if (!docId) return;
    const clean = text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!clean) return;
    const next = markups.map((m) =>
      m.id === id && m.kind === "text" ?
        { ...m, text: clean, updatedAt: Date.now() }
      : m,
    );
    set({ markups: next });
    persistMarkups(docId, next);
  },

  remove: (id: string) => {
    const { docId, markups } = get();
    if (!docId) return;
    const next = markups.filter((m) => m.id !== id);
    set({ markups: next });
    persistMarkups(docId, next);
  },

  markupsForPage: (page: number) => get().markups.filter((m) => m.page === page),
}));

export type { MarkupKind };
