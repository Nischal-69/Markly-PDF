import { create } from "zustand";
import {
  closePdfDocument,
  loadPdfDocument,
  PdfLoadError,
} from "@/lib/pdf/pdfEngine";
import {
  cancelSearchRuns,
  clearSearchCache,
} from "@/lib/search/searchEngine";
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
/** Zoom follows the chosen fit strategy until the user zooms manually. */
export type FitMode = "width" | "page" | "custom";

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const DEFAULT_SCALE = 1;
/** Must mirror `.pdf-scroll` padding in viewer.css (24px sides, 24+48 vertical). */
export const VIEWER_PAD_X = 48;
export const VIEWER_PAD_Y = 72;

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
  fitMode: FitMode;

  sidebarView: SidebarView;
  showThumbnails: boolean;
  screen: Screen;
  isFullscreen: boolean;
  /**
   * Bumps when the toolbar asks for fullscreen. The viewer (which owns the
   * element) performs the request; exits via Esc/overlay sync back
   * through `isFullscreen` via the fullscreenchange event.
   */
  fsToken: number;

  /** 0..1 while a document is parsing, otherwise null. */
  loadProgress: number | null;
  /** Transient toast message (e.g. "Search is coming soon"). */
  notice: string | null;
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
  /** Returns to the open document without reloading (e.g. from Notes). */
  showViewer: () => void;
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
  setFitMode: (mode: FitMode) => void;
  applyFit: (
    containerWidth: number,
    containerHeight: number,
    pageWidthPt: number,
    pageHeightPt: number,
  ) => void;

  setSidebarView: (view: SidebarView) => void;
  toggleThumbnails: () => void;
  setFullscreen: (enabled: boolean) => void;
  requestFullscreen: () => void;
  notify: (message: string) => void;
  dismissNotice: () => void;
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
  fitMode: "width",

  sidebarView: "home",
  showThumbnails: true,
  screen: "library",
  navToken: 0,
  isFullscreen: false,
  fsToken: 0,

  loadProgress: null,
  notice: null,

  error: null,
  errorDetails: null,

  recent: [],

  openPdf: async (input: OpenedPdfInput) => {
    set({
      status: "loading",
      loadProgress: 0,
      error: null,
      errorDetails: null,
      fileName: input.name,
      filePath: input.path || null,
      fileSize: input.size,
    });
    try {
      const key =
        input.path || `${input.name}:${input.size}:${Date.now()}`;
      const doc = await loadPdfDocument(input.data, key, (loaded, total) => {
        set({
          loadProgress:
            total > 0 ? Math.min(1, Math.max(0, loaded / total)) : null,
        });
      });
      const recent = addRecentFile({
        id: makeRecentId(input.path, input.name, input.size),
        name: input.name,
        path: input.path,
        size: input.size,
        numPages: doc.numPages,
      });
      set({
        status: "ready",
        loadProgress: null,
        numPages: doc.numPages,
        currentPage: 1,
        docKey: `${Date.now()}`,
        screen: "viewer",
        navToken: get().navToken + 1,
        scale: DEFAULT_SCALE,
        fitMode: "width",
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
        loadProgress: null,
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
    // Release everything the document held: abort in-flight search loops
    // (they would otherwise page a destroyed document to completion) and
    // drop cached page texts so a large PDF's strings don't linger.
    cancelSearchRuns();
    clearSearchCache();
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
      fitMode: "width",
      isFullscreen: false,
      loadProgress: null,
      error: null,
      errorDetails: null,
    });
  },

  refreshRecent: () => set({ recent: listRecentFiles() }),
  showViewer: () =>
    set((s) => (s.docKey && s.numPages > 0 ? { screen: "viewer" } : s)),
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
    set((s) => ({ scale: clampScale(s.scale * 1.25), fitMode: "custom" })),
  zoomOut: () =>
    set((s) => ({ scale: clampScale(s.scale / 1.25), fitMode: "custom" })),
  setScale: (scale: number) =>
    set({ scale: clampScale(scale), fitMode: "custom" }),
  resetZoom: () => set({ scale: DEFAULT_SCALE, fitMode: "custom" }),
  setFitMode: (mode: FitMode) => set({ fitMode: mode }),

  applyFit: (containerWidth, containerHeight, pageWidthPt, pageHeightPt) => {
    const mode = get().fitMode;
    if (mode === "custom") return;
    if (pageWidthPt <= 0 || pageHeightPt <= 0) return;
    const availW = containerWidth - VIEWER_PAD_X;
    const availH = containerHeight - VIEWER_PAD_Y;
    if (availW <= 0 || availH <= 0) return;
    const next =
      mode === "page"
        ? Math.min(availW / pageWidthPt, availH / pageHeightPt)
        : availW / pageWidthPt;
    const clamped = clampScale(next);
    if (Math.abs(clamped - get().scale) > 0.001) set({ scale: clamped });
  },

  setSidebarView: (view: SidebarView) =>
    set({ sidebarView: view, screen: "library" }),
  toggleThumbnails: () => set((s) => ({ showThumbnails: !s.showThumbnails })),
  setFullscreen: (enabled: boolean) => set({ isFullscreen: enabled }),
  requestFullscreen: () => set((s) => ({ fsToken: s.fsToken + 1 })),
  notify: (message: string) => set({ notice: message }),
  dismissNotice: () => set({ notice: null }),
  dismissError: () =>
    set((s) => ({
      error: null,
      errorDetails: null,
      status: s.numPages > 0 ? s.status : "idle",
    })),
}));
