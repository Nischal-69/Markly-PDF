import { getStorageProvider } from "./storage";

export interface RecentFile {
  /** Stable id: Tauri file path when known, otherwise name+size. */
  id: string;
  name: string;
  /** Empty when the file was picked via the browser picker (no path). */
  path: string;
  size: number;
  lastOpenedAt: number;
  numPages: number | null;
}

const STORAGE_KEY = "markly.recent.v1";
const MAX_RECENT = 20;

function readAll(): RecentFile[] {
  const raw = getStorageProvider().getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentFile =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentFile).name === "string" &&
        typeof (e as RecentFile).id === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(entries: RecentFile[]): void {
  getStorageProvider().setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function listRecentFiles(): RecentFile[] {
  return readAll().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function addRecentFile(entry: Omit<RecentFile, "lastOpenedAt">): RecentFile[] {
  const now = Date.now();
  const rest = readAll().filter((e) => e.id !== entry.id);
  const next = [{ ...entry, lastOpenedAt: now }, ...rest].slice(0, MAX_RECENT);
  writeAll(next);
  return listRecentFiles();
}

export function removeRecentFile(id: string): RecentFile[] {
  writeAll(readAll().filter((e) => e.id !== id));
  return listRecentFiles();
}

export function clearRecentFiles(): RecentFile[] {
  getStorageProvider().removeItem(STORAGE_KEY);
  return [];
}

export function makeRecentId(path: string, name: string, size: number): string {
  return path ? `path:${path}` : `file:${name}:${size}`;
}
