/**
 * Batch 8 — Save / Save As / Export state.
 *
 * - Save / Save As write a `.markly.json` project file (overlay metadata
 *   only — the original PDF is never touched).
 * - Export PDF burns overlays into a new PDF via pdf-lib.
 * - The original PDF is never overwritten unless the user explicitly
 *   confirms it in the overwrite dialog (see fileHandling guards).
 * - Export reports per-page progress so large PDFs show a live indicator;
 *   failures set `exportError` for the dialog instead of crashing.
 */

import { create } from "zustand";
import { getOriginalBytes } from "@/lib/pdf/pdfEngine";
import {
  defaultExportName,
  defaultProjectName,
  exportAnnotatedPdf,
  PdfExportError,
  type ExportProgress,
} from "@/lib/export/pdfExport";
import {
  isTauriRuntime,
  saveBytesToLocation,
  writeBytesToKnownPath,
  type SaveResult,
} from "@/lib/files/fileHandling";
import {
  serializeProject,
  type MarklyProject,
} from "@/lib/project/projectFile";
import { currentDocId } from "@/lib/annotations/docId";
import { usePdfStore } from "@/state/pdfStore";
import { useHighlightStore } from "@/state/highlightStore";
import { useMarkupStore } from "@/state/markupStore";
import { useNoteStore } from "@/state/noteStore";
import { useBookmarkStore } from "@/state/bookmarkStore";

interface SaveState {
  /** Remembered project file per document (Tauri only; browser has no paths). */
  projectPaths: Record<string, string>;
  saveBusy: boolean;

  isExporting: boolean;
  exportRatio: number;
  exportPhase: ExportProgress["phase"] | null;
  exportPage: number;
  exportTotal: number;
  exportError: string | null;
  lastExportName: string | null;

  saveProject: () => Promise<SaveResult>;
  saveProjectAs: () => Promise<SaveResult>;
  exportPdf: () => Promise<SaveResult>;
  cancelExportError: () => void;
}

function collectProject(): MarklyProject | null {
  const pdf = usePdfStore.getState();
  const docId = currentDocId();
  if (!docId || !pdf.fileName) return null;
  const highlights = useHighlightStore.getState().highlights.filter((h) => h.docId === docId);
  const markups = useMarkupStore.getState().markups.filter((m) => m.docId === docId);
  const notes = useNoteStore.getState().notesForDoc(docId);
  const bookmarks = useBookmarkStore.getState().forDoc(docId);
  return {
    app: "markly-pdf",
    version: 1,
    docId,
    docName: pdf.fileName,
    sourcePath: pdf.filePath || null,
    sourceSize: pdf.fileSize ?? null,
    numPages: pdf.numPages,
    savedAt: Date.now(),
    highlights,
    markups,
    notes,
    bookmarks,
  };
}

function countAnnotations(p: MarklyProject): number {
  return p.highlights.length + p.markups.length + p.notes.length;
}

export const useSaveStore = create<SaveState>()((set, get) => ({
  projectPaths: {},
  saveBusy: false,

  isExporting: false,
  exportRatio: 0,
  exportPhase: null,
  exportPage: 0,
  exportTotal: 0,
  exportError: null,
  lastExportName: null,

  saveProject: async () => {
    const pdf = usePdfStore.getState();
    if (get().saveBusy) return "cancelled";
    const project = collectProject();
    if (!project) {
      pdf.notify("Open a PDF before saving.");
      return "cancelled";
    }
    const known = get().projectPaths[project.docId];
    const json = serializeProject(project);
    const bytes = new TextEncoder().encode(json);

    // Known location (Tauri): overwrite the *project* file silently.
    // The original PDF stays guarded even here.
    if (known && isTauriRuntime()) {
      set({ saveBusy: true });
      try {
        const result = await writeBytesToKnownPath(known, bytes, pdf.filePath);
        if (result === "saved") {
          pdf.notify(`Project saved (${countAnnotations(project)} annotations).`);
        } else if (result === "overwrite-aborted") {
          pdf.notify("Save cancelled — the original PDF was kept.");
        }
        return result;
      } catch {
        pdf.notify("Could not save the project. Please try again.");
        return "cancelled";
      } finally {
        set({ saveBusy: false });
      }
    }
    // No known path (or browser): fall back to Save As.
    return get().saveProjectAs();
  },

  saveProjectAs: async () => {
    const pdf = usePdfStore.getState();
    if (get().saveBusy) return "cancelled";
    const project = collectProject();
    if (!project) {
      pdf.notify("Open a PDF before saving.");
      return "cancelled";
    }
    const suggested = defaultProjectName(project.docName);
    const bytes = new TextEncoder().encode(serializeProject(project));
    set({ saveBusy: true });
    try {
      const { result, path } = await saveBytesToLocation(
        suggested,
        bytes,
        "application/json",
        "Save Markly project",
        { name: "Markly project", extensions: ["json"] },
        pdf.filePath,
      );
      if (result === "saved") {
        if (path) {
          set((s) => ({ projectPaths: { ...s.projectPaths, [project.docId]: path } }));
        }
        pdf.notify(`Project saved (${countAnnotations(project)} annotations).`);
      } else if (result === "overwrite-aborted") {
        pdf.notify("Save cancelled — the original PDF was kept.");
      }
      return result;
    } catch {
      pdf.notify("Could not save the project. Please try again.");
      return "cancelled";
    } finally {
      set({ saveBusy: false });
    }
  },

  exportPdf: async () => {
    const pdf = usePdfStore.getState();
    if (get().isExporting) return "cancelled";
    const project = collectProject();
    if (!project) {
      pdf.notify("Open a PDF before exporting.");
      return "cancelled";
    }
    const original = getOriginalBytes();
    if (!original) {
      set({ exportError: "No PDF data is loaded. Reopen the file and try again." });
      pdf.notify("Could not export the PDF. Please try again.");
      return "cancelled";
    }

    set({
      isExporting: true,
      exportRatio: 0,
      exportPhase: "load",
      exportPage: 0,
      exportTotal: pdf.numPages || 1,
      exportError: null,
    });

    let burned: Uint8Array;
    try {
      burned = await exportAnnotatedPdf(
        original,
        { highlights: project.highlights, markups: project.markups, notes: project.notes },
        (p) => {
          set({
            exportPhase: p.phase,
            exportPage: p.page,
            exportTotal: p.totalPages,
            exportRatio: p.ratio,
          });
        },
      );
    } catch (raw) {
      const message =
        raw instanceof PdfExportError
          ? raw.message
          : "The annotated PDF could not be created. Please try again.";
      set({ isExporting: false, exportError: message, exportPhase: null });
      pdf.notify(message);
      return "cancelled";
    }

    // Burned bytes are ready — ask where to write them. The default name
    // is `<original>-annotated.pdf` so the source is never clobbered by
    // accident; picking the original path needs explicit confirmation.
    try {
      const suggested = defaultExportName(project.docName);
      const { result, path } = await saveBytesToLocation(
        suggested,
        burned,
        "application/pdf",
        "Export annotated PDF",
        { name: "PDF documents", extensions: ["pdf"] },
        pdf.filePath,
      );
      if (result === "saved") {
        set({
          isExporting: false,
          exportRatio: 1,
          exportPhase: null,
          lastExportName: path ?? suggested,
        });
        const n = countAnnotations(project);
        pdf.notify(
          n > 0
            ? `Exported annotated PDF with ${n} annotation${n === 1 ? "" : "s"}.`
            : "Exported PDF (no annotations yet).",
        );
      } else if (result === "overwrite-aborted") {
        set({ isExporting: false, exportPhase: null });
        pdf.notify("Export cancelled — the original PDF was kept.");
      } else {
        set({ isExporting: false, exportPhase: null });
      }
      return result;
    } catch {
      const message = "The annotated PDF could not be written. Please try again.";
      set({ isExporting: false, exportError: message, exportPhase: null });
      pdf.notify(message);
      return "cancelled";
    }
  },

  cancelExportError: () => set({ exportError: null }),
}));
