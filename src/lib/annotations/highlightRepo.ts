import { getStorageProvider } from "@/lib/storage/storage";
import {
  isHighlightColorId,
  type Highlight,
} from "./highlightTypes";

const STORAGE_KEY = "markly.highlights.v1";

type HighlightMap = Record<string, Highlight[]>;

function isValidQuad(q: unknown): boolean {
  if (typeof q !== "object" || q === null) return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.left === "number" &&
    typeof r.top === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    Number.isFinite(r.left) &&
    Number.isFinite(r.top) &&
    r.width > 0 &&
    r.height > 0
  );
}

function sanitize(list: unknown): Highlight[] {
  if (!Array.isArray(list)) return [];
  const out: Highlight[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const h = raw as Record<string, unknown>;
    if (
      typeof h.id !== "string" ||
      typeof h.docId !== "string" ||
      typeof h.page !== "number" ||
      !Number.isFinite(h.page) ||
      typeof h.text !== "string" ||
      !isHighlightColorId(h.color) ||
      !Array.isArray(h.quads) ||
      h.quads.length === 0 ||
      !h.quads.every(isValidQuad)
    ) {
      continue;
    }
    const range = h.range as Record<string, unknown> | undefined;
    out.push({
      id: h.id,
      docId: h.docId,
      page: h.page,
      text: h.text,
      color: h.color,
      range: {
        beginDiv: typeof range?.beginDiv === "number" ? range.beginDiv : 0,
        beginOffset:
          typeof range?.beginOffset === "number" ? range.beginOffset : 0,
        endDiv: typeof range?.endDiv === "number" ? range.endDiv : 0,
        endOffset: typeof range?.endOffset === "number" ? range.endOffset : 0,
      },
      quads: h.quads as Highlight["quads"],
      createdAt: typeof h.createdAt === "number" ? h.createdAt : 0,
      updatedAt: typeof h.updatedAt === "number" ? h.updatedAt : 0,
    });
  }
  return out;
}

function readAll(): HighlightMap {
  const raw = getStorageProvider().getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: HighlightMap = {};
    for (const [docId, list] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const clean = sanitize(list);
      if (clean.length > 0) result[docId] = clean;
    }
    return result;
  } catch {
    return {};
  }
}

function writeAll(map: HighlightMap): void {
  getStorageProvider().setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Persistence for highlights, built on the storage abstraction.
 * A future SQLite provider implements the same `StorageProvider`
 * interface — this module needs no changes for that migration.
 */
export function loadHighlights(docId: string): Highlight[] {
  return readAll()[docId] ?? [];
}

export function persistHighlights(docId: string, list: Highlight[]): void {
  const all = readAll();
  if (list.length === 0) {
    delete all[docId];
  } else {
    all[docId] = list;
  }
  writeAll(all);
}

export function createHighlightId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `hl_${crypto.randomUUID()}`;
  }
  return `hl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
