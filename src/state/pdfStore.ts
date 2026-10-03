import { create } from "zustand";
import {
  closePdfDocument,
  loadPdfDocument,
  PdfLoadError,
} from "@/lib/pdf/pdfEngine";
import {
  addRecentFile,
  clearRecentFiles,
  listRecentFiles,
  makeRecentId,
  removeRecentFile,
  type RecentFile,
} from "@/lib/storage/recentFiles";
import type { OpenedPdfInput } from "@/lib/files/fileHandling";

export type SidebarView = "home" | "recent" | "notes" | "bookmarks";
export type LoadStatus = "idle" | "loading" | "ready" | "error";
/** Library = sidebar screens; viewer = open document takes the main area. */
export type Screen = "library" | "viewer";

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const DEFAULT_SCALE = 1;

const clampScale = (value: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));

interface PdfState {
  status: LoadStatus;

  fileName: string | null;
  filePath: string | null;
  fileSize: number | null;
  /** Bumps on every successful open; lets the viewer reset scroll/page. */
  docKey: string | null;

  numPages: number;
  currentPage: number;

  scale: number;
  fitToWidth: boolean;

  sidebarView: SidebarView;
  showThumbnails: boolean;
  screen: Screen;
  /**
   * Bumps on every programmatic navigation (toolbar buttons, thumbnails,
   * page input). The viewer scrolls on token change; scroll-driven
   * position updates use setCurrentPage and do NOT bump it (no loops).
   */
  navToken: number;

  error: string | null;
  errorDetails: string | null;

  recent: RecentFile[];

  openPdf: (input: OpenedPdfInput) => Promise<void>;
  closeDocument: () => void;
  refreshRecent: () => void;
  removeRecent: (id: string) => void;
  clearRecent: () => void;

  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setCurrentPage: (page: number) => void;

  zoomIn: () => void;
  zoomOut: () => void;
  setScale: (scale: number) => void;
  resetZoom: () => void;
  setFitToWidth: (enabled: boolean) => void;
  applyFitWidth: (containerWidth: number, pageWidthPt: number) => void;

  setSidebarView: (view: SidebarView) => void;
  toggleThumbnails: () => void;
  dismissError: () => void;
}

export const usePdfStore = create<PdfState>()((set, get) => ({
  status: "idle",

  fileName: null,
  filePath: null,
  fileSize: null,
  docKey: null,

  numPages: 0,
  currentPage: 1,

  scale: DEFAULT_SCALE,
  fitToWidth: true,

  sidebarView: "home",
  showThumbnails: true,
  screen: "library",
  navToken: 0,

  error: null,
  errorDetails: null,

  recent: [],

  openPdf: async (input: OpenedPdfInput) => {
    set({
      status: "loading",
      error: null,
      errorDetails: null,
      fileName: input.name,
      filePath: input.path || null,
      fileSize: input.size,
    });
    try {
      const key =
        input.path || `${input.name}:${input.size}:${Date.now()}`;
      const doc = await loadPdfDocument(input.data, key);
      const recent = addRecentFile({
        id: makeRecentId(input.path, input.name, input.size),
        name: input.name,
        path: input.path,
        size: input.size,
        numPages: doc.numPages,
      });
      set({
        status: "ready",
        numPages: doc.numPages,
        currentPage: 1,
        docKey: `${Date.now()}`,
        screen: "viewer",
        navToken: get().navToken + 1,
        scale: get().fitToWidth ? get().scale : DEFAULT_SCALE,
        fitToWidth: true,
        recent,
      });
    } catch (raw) {
      await closePdfDocument().catch(() => undefined);
      const message =
        raw instanceof PdfLoadError
          ? raw.message
          : "This PDF could not be opened. Please try a different file.";
      set({
        status: "error",
        error: message,
        errorDetails:
          raw instanceof PdfLoadError
            ? (raw.details ?? null)
            : raw instanceof Error
              ? raw.message
              : null,
        numPages: 0,
      });
    }
  },

  closeDocument: () => {
    void closePdfDocument().catch(() => undefined);
    set({
      status: "idle",
      screen: "library",
      fileName: null,
      filePath: null,
      fileSize: null,
      docKey: null,
      numPages: 0,
      currentPage: 1,
      scale: DEFAULT_SCALE,
      fitToWidth: true,
      error: null,
      errorDetails: null,
    });
  },

  refreshRecent: () => set({ recent: listRecentFiles() }),
  removeRecent: (id: string) => set({ recent: removeRecentFile(id) }),
  clearRecent: () => set({ recent: clearRecentFiles() }),

  goToPage: (page: number) => {
    const { numPages } = get();
    if (numPages < 1) return;
    const clamped = Math.min(numPages, Math.max(1, Math.floor(page)));
    set((s) => ({
      currentPage: clamped,
      navToken: s.navToken + 1,
    }));
  },
  nextPage: () => get().goToPage(get().currentPage + 1),
  prevPage: () => get().goToPage(get().currentPage - 1),
  setCurrentPage: (page: number) => {
    const { numPages, currentPage } = get();
    const clamped = Math.min(numPages, Math.max(1, Math.floor(page)));
    if (clamped !== currentPage) set({ currentPage: clamped });
  },

  zoomIn: () =>
    set((s) => ({ scale: clampScale(s.scale * 1.25), fitToWidth: false })),
  zoomOut: () =>
    set((s) => ({ scale: clampScale(s.scale / 1.25), fitToWidth: false })),
  setScale: (scale: number) =>
    set({ scale: clampScale(scale), fitToWidth: false }),
  resetZoom: () => set({ scale: DEFAULT_SCALE, fitToWidth: false }),
  setFitToWidth: (enabled: boolean) => set({ fitToWidth: enabled }),

  applyFitWidth: (containerWidth: number, pageWidthPt: number) => {
    if (!get().fitToWidth || pageWidthPt <= 0 || containerWidth <= 0) return;
    const next = clampScale(containerWidth / pageWidthPt);
    if (Math.abs(next - get().scale) > 0.001) set({ scale: next });
  },

  setSidebarView: (view: SidebarView) =>
    set({ sidebarView: view, screen: "library" }),
  toggleThumbnails: () => set((s) => ({ showThumbnails: !s.showThumbnails })),
  dismissError: () =>
    set((s) => ({
      error: null,
      errorDetails: null,
      status: s.numPages > 0 ? s.status : "idle",
    })),
}));
