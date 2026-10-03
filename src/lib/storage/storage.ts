/**
 * Storage abstraction.
 *
 * Batch 1 persists through a localStorage-backed provider.
 * A future SQLite provider (Tauri `tauri-plugin-sql`, fully offline/local)
 * implements this same interface — callers must never touch
 * localStorage / SQL directly.
 */
export interface StorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class LocalStorageProvider implements StorageProvider {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage full or unavailable (private mode): non-fatal.
    }
  }

  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Non-fatal.
    }
  }
}

// Future: `class SqliteStorageProvider implements StorageProvider { ... }`
// swapped in here once `tauri-plugin-sql` is wired up. No caller changes.

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) provider = new LocalStorageProvider();
  return provider;
}

/** Test seam: replaces the active provider (used by future tests). */
export function setStorageProvider(next: StorageProvider | null): void {
  provider = next;
}
