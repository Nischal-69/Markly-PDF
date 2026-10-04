import { getStorageProvider } from "@/lib/storage/storage";

/**
 * Batch 7 bookmarks: per-page jump marks, stored locally.
 *
 * Flat list across documents (like notes) so the library panel can show
 * every bookmark; per-document views filter by `docId`. PDF bytes are
 * never stored — only metadata.
 */

export interface Bookmark {
  id: string;
  /** Stable document key (same scheme as highlights / recent). */
  docId: string;
  docName: string;
  page: number;
  /** User-editable label; defaults to "Page N". */
  title: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "markly.bookmarks.v1";
const MAX_TITLE = 200;

function sanitizePage(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function sanitize(list: unknown): Bookmark[] {
  if (!Array.isArray(list)) return [];
  const out: Bookmark[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const b = raw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) continue;
    if (typeof b.docId !== "string" || !b.docId) continue;
    const page = sanitizePage(b.page, 0);
    if (page < 1) continue;
    out.push({
      id: b.id,
      docId: b.docId,
      docName: typeof b.docName === "string" && b.docName ? b.docName : "Document",
      page,
      title:
        typeof b.title === "string" && b.title.trim()
          ? b.title.trim().slice(0, MAX_TITLE)
          : `Page ${page}`,
      createdAt: typeof b.createdAt === "number" ? b.createdAt : 0,
      updatedAt: typeof b.updatedAt === "number" ? b.updatedAt : 0,
    });
  }
  return out;
}

function readAll(): Bookmark[] {
  const raw = getStorageProvider().getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeAll(list: Bookmark[]): void {
  getStorageProvider().setItem(STORAGE_KEY, JSON.stringify(list));
}

export function loadBookmarks(): Bookmark[] {
  return readAll();
}

export function persistBookmarks(list: Bookmark[]): void {
  writeAll(list);
}

export function cleanBookmarkTitle(title: string, page: number): string {
  const trimmed = title.trim().slice(0, MAX_TITLE);
  return trimmed || `Page ${page}`;
}

export function createBookmarkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `bm_${crypto.randomUUID()}`;
  }
  return `bm_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}
