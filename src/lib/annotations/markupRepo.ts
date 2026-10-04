import { getStorageProvider } from "@/lib/storage/storage";
import {
  DEFAULT_MARKUP_COLOR,
  DEFAULT_MARKUP_STROKE,
  DEFAULT_TEXT_SIZE,
  MAX_TEXT_LENGTH,
  isMarkupColorSwatch,
  isMarkupKind,
  type Markup,
  type MarkupPoint,
  type MarkupQuad,
} from "./markupTypes";

const STORAGE_KEY = "markly.markups.v1";

type MarkupMap = Record<string, Markup[]>;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function validQuad(q: unknown): q is MarkupQuad {
  if (typeof q !== "object" || q === null) return false;
  const r = q as Record<string, unknown>;
  return (
    finite(r.left) &&
    finite(r.top) &&
    finite(r.width) &&
    finite(r.height) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}

function validPoint(p: unknown): p is MarkupPoint {
  if (typeof p !== "object" || p === null) return false;
  const r = p as Record<string, unknown>;
  return finite(r.x) && finite(r.y);
}

function cleanBase(h: Record<string, unknown>): {
  id: string;
  docId: string;
  page: number;
  color: string;
  stroke: number;
  createdAt: number;
  updatedAt: number;
} | null {
  if (typeof h.id !== "string" || typeof h.docId !== "string") return null;
  if (!finite(h.page) || (h.page as number) < 1) return null;
  return {
    id: h.id,
    docId: h.docId,
    page: Math.floor(h.page as number),
    color: isMarkupColorSwatch(h.color) ? (h.color as string) : DEFAULT_MARKUP_COLOR,
    stroke:
      finite(h.stroke) ?
        Math.min(12, Math.max(0.5, h.stroke as number))
      : DEFAULT_MARKUP_STROKE,
    createdAt: finite(h.createdAt) ? (h.createdAt as number) : 0,
    updatedAt: finite(h.updatedAt) ? (h.updatedAt as number) : 0,
  };
}

function sanitize(list: unknown): Markup[] {
  if (!Array.isArray(list)) return [];
  const out: Markup[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const h = raw as Record<string, unknown>;
    if (!isMarkupKind(h.kind)) continue;
    const base = cleanBase(h);
    if (!base) continue;
    switch (h.kind) {
      case "underline":
      case "strike": {
        if (!Array.isArray(h.quads) || h.quads.length === 0) break;
        if (!(h.quads as unknown[]).every(validQuad)) break;
        out.push({
          ...base,
          kind: h.kind,
          quads: h.quads as MarkupQuad[],
          text: typeof h.text === "string" ? h.text.slice(0, MAX_TEXT_LENGTH) : "",
        });
        break;
      }
      case "freehand": {
        if (!Array.isArray(h.points) || (h.points as unknown[]).length < 2) break;
        if (!(h.points as unknown[]).every(validPoint)) break;
        out.push({ ...base, kind: "freehand", points: h.points as MarkupPoint[] });
        break;
      }
      case "rect":
      case "ellipse": {
        if (!finite(h.x) || !finite(h.y) || !finite(h.w) || !finite(h.h)) break;
        if ((h.w as number) <= 0 || (h.h as number) <= 0) break;
        out.push({
          ...base,
          kind: h.kind,
          x: h.x as number,
          y: h.y as number,
          w: h.w as number,
          h: h.h as number,
        });
        break;
      }
      case "arrow": {
        if (!finite(h.x1) || !finite(h.y1) || !finite(h.x2) || !finite(h.y2)) break;
        out.push({
          ...base,
          kind: "arrow",
          x1: h.x1 as number,
          y1: h.y1 as number,
          x2: h.x2 as number,
          y2: h.y2 as number,
        });
        break;
      }
      case "text": {
        if (!finite(h.x) || !finite(h.y)) break;
        if (typeof h.text !== "string" || h.text.trim() === "") break;
        const fontSize =
          finite(h.fontSize) ?
            Math.min(72, Math.max(8, h.fontSize as number))
          : DEFAULT_TEXT_SIZE;
        out.push({
          ...base,
          kind: "text",
          x: h.x as number,
          y: h.y as number,
          text: (h.text as string).slice(0, MAX_TEXT_LENGTH),
          fontSize,
        });
        break;
      }
    }
  }
  return out;
}

function readAll(): MarkupMap {
  const raw = getStorageProvider().getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: MarkupMap = {};
    for (const [docId, list] of Object.entries(parsed as Record<string, unknown>)) {
      const clean = sanitize(list);
      if (clean.length > 0) result[docId] = clean;
    }
    return result;
  } catch {
    return {};
  }
}

function writeAll(map: MarkupMap): void {
  getStorageProvider().setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Persistence for freeform markups, built on the same storage
 * abstraction as highlights (localStorage now, SQLite later without
 * caller changes). Overlay metadata only — PDF bytes are never stored.
 */
export function loadMarkups(docId: string): Markup[] {
  return readAll()[docId] ?? [];
}

export function persistMarkups(docId: string, list: Markup[]): void {
  const all = readAll();
  if (list.length === 0) {
    delete all[docId];
  } else {
    all[docId] = list;
  }
  writeAll(all);
}
