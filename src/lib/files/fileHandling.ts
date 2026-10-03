import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, stat } from "@tauri-apps/plugin-fs";

export interface OpenedPdfInput {
  name: string;
  /** Real filesystem path under Tauri; "" when picked via browser picker. */
  path: string;
  size: number;
  data: ArrayBuffer;
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !==
      undefined ||
      (window as unknown as Record<string, unknown>).__TAURI__ !== undefined)
  );
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Browser fallback: classic file picker (also used for Batch 1 web tests). */
function pickViaBrowser(): Promise<OpenedPdfInput | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = false;

    let settled = false;
    const done = (value: OpenedPdfInput | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    // `cancel` fires in modern browsers when the dialog is dismissed.
    input.addEventListener("cancel", () => done(null));
    // Fallback for browsers without `cancel`: dismiss on window focus.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      window.setTimeout(() => done(null), 300);
    };
    window.addEventListener("focus", onFocus);

    input.addEventListener("change", () => {
      window.removeEventListener("focus", onFocus);
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      void file.arrayBuffer().then((buffer) =>
        done({ name: file.name, path: "", size: file.size, data: buffer }),
      );
    });

    input.click();
  });
}

/** Native Tauri path: system file dialog + direct fs read (offline). */
async function pickViaTauri(): Promise<OpenedPdfInput | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF documents", extensions: ["pdf"] }],
    title: "Open PDF in Markly PDF",
  });
  if (!selected || Array.isArray(selected)) return null;

  const [bytes, meta] = await Promise.all([
    readFile(selected),
    stat(selected).catch(() => null),
  ]);
  // Copy out of the plugin's buffer into a standalone ArrayBuffer.
  const data = new Uint8Array(bytes).buffer as ArrayBuffer;
  return {
    name: fileNameFromPath(selected),
    path: selected,
    size: meta?.size ?? bytes.byteLength,
    data,
  };
}

/**
 * Reopens a recent entry without a file picker when possible.
 * Under Tauri the stored filesystem path is read directly (offline).
 * Returns `null` when the entry cannot be reopened silently — the caller
 * should then fall back to {@link openPdfFromDisk}.
 */
export async function openRecentEntry(entry: {
  path: string;
  name: string;
}): Promise<OpenedPdfInput | null> {
  if (!isTauriRuntime() || !entry.path) return null;
  try {
    const [bytes, meta] = await Promise.all([
      readFile(entry.path),
      stat(entry.path).catch(() => null),
    ]);
    const data = new Uint8Array(bytes).buffer as ArrayBuffer;
    return {
      name: entry.name,
      path: entry.path,
      size: meta?.size ?? bytes.byteLength,
      data,
    };
  } catch {
    return null;
  }
}

/**
 * Opens one PDF from the local computer.
 * Returns `null` when the user cancels — never throws for cancellation.
 * Throws only for genuine I/O failures (handled by the caller).
 */
export async function openPdfFromDisk(): Promise<OpenedPdfInput | null> {
  if (isTauriRuntime()) {
    try {
      return await pickViaTauri();
    } catch {
      // Native dialog unavailable/blocked — fall back to browser picker.
      return pickViaBrowser();
    }
  }
  return pickViaBrowser();
}
