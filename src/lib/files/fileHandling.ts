import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { getOriginalBytes } from "@/lib/pdf/pdfEngine";

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

export type SaveResult = "saved" | "cancelled" | "overwrite-aborted";

/** Normalizes a filesystem path for same-file comparison (Windows-safe). */
export function isSamePath(a: string, b: string): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase().trim();
  return norm(a) === norm(b);
}

/**
 * Asks the user to explicitly confirm overwriting the original PDF.
 * Returns true when the user explicitly chooses to overwrite.
 */
export function confirmOverwriteOriginal(fileName: string): boolean {
  try {
    return window.confirm(
      `You chose the original file location for "${fileName}".\n\nOverwrite the original PDF? Choose OK to overwrite, or Cancel to pick a different location.`,
    );
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Writes raw bytes to a user-chosen location (Tauri save dialog, browser
 * download fallback). When `guardOriginalPath` is set and the user picks
 * that exact location, an explicit overwrite confirmation is required —
 * cancelling returns "overwrite-aborted" and writes nothing.
 */
export async function saveBytesToLocation(
  suggestedName: string,
  bytes: Uint8Array,
  mimeType: string,
  dialogTitle: string,
  dialogFilter: { name: string; extensions: string[] },
  guardOriginalPath?: string | null,
): Promise<{ result: SaveResult; path: string | null }> {
  const fileName = suggestedName || "document";
  if (isTauriRuntime()) {
    try {
      const target = await saveDialog({
        defaultPath: fileName,
        title: dialogTitle,
        filters: [dialogFilter],
      });
      if (!target) return { result: "cancelled", path: null };
      if (guardOriginalPath && isSamePath(target, guardOriginalPath)) {
        if (!confirmOverwriteOriginal(fileName)) {
          return { result: "overwrite-aborted", path: target };
        }
      }
      await writeFile(target, bytes);
      return { result: "saved", path: target };
    } catch {
      // Native save unavailable — fall through to browser download.
    }
  }
  downloadBlob(
    new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }),
    fileName,
  );
  return { result: "saved", path: null };
}

/**
 * Writes bytes to a previously chosen project path without a dialog
 * (Save). Falls back to a dialog when no path is known. The original PDF
 * is still guarded: overwriting it requires explicit confirmation.
 */
export async function writeBytesToKnownPath(
  targetPath: string,
  bytes: Uint8Array,
  guardOriginalPath?: string | null,
): Promise<SaveResult> {
  if (!isTauriRuntime()) {
    // Browser has no persistent path — caller should use saveBytesToLocation.
    throw new Error("No saved location in the browser. Use Save As.");
  }
  if (guardOriginalPath && isSamePath(targetPath, guardOriginalPath)) {
    const base = targetPath.split(/[\\/]/).pop() ?? targetPath;
    if (!confirmOverwriteOriginal(base)) return "overwrite-aborted";
  }
  await writeFile(targetPath, bytes);
  return "saved";
}

/**
 * Saves a copy of the currently loaded PDF (original bytes, unmodified).
 * Under Tauri this shows the native save dialog; in the browser it
 * triggers a download. Throws when no document is loaded or I/O fails.
 */
export async function saveCurrentPdfCopy(suggestedName: string): Promise<SaveResult> {
  const bytes = getOriginalBytes();
  if (!bytes) throw new Error("No PDF document is loaded.");

  const fileName =
    suggestedName.toLowerCase().endsWith(".pdf") || suggestedName === ""
      ? suggestedName || "document.pdf"
      : `${suggestedName}.pdf`;

  if (isTauriRuntime()) {
    try {
      const target = await saveDialog({
        defaultPath: fileName,
        title: "Save a copy of this PDF",
        filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      });
      if (!target) return "cancelled";
      await writeFile(target, bytes);
      return "saved";
    } catch {
      // Native save unavailable — fall through to browser download.
    }
  }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "saved";
}
