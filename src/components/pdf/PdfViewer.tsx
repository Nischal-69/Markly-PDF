import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PdfPage } from "./PdfPage";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { SearchBar } from "@/components/search/SearchBar";
import { Icon } from "@/components/icons/Icon";
import {
  captureSelection,
  clearDomSelection,
  getSelectionAnchorRect,
} from "@/lib/annotations/selection";
import { saveCurrentPdfCopy } from "@/lib/files/fileHandling";
import { makeRecentId } from "@/lib/storage/recentFiles";
import { useHighlightStore } from "@/state/highlightStore";
import { anchorFromRect, useHighlightUi } from "@/state/highlightUi";
import { useMarkupStore } from "@/state/markupStore";
import { isTextMarkupTool, useMarkupUi } from "@/state/markupUi";
import { useBookmarkStore } from "@/state/bookmarkStore";
import { useSearchStore } from "@/state/searchStore";
import { useNoteUi } from "@/state/noteUi";
import { usePdfStore } from "@/state/pdfStore";

const PAGE_GAP = 16;
const WHEEL_ZOOM_THROTTLE_MS = 80;
/** Quiet window after a jump: the target page wins over scroll-sync. */
const NAV_SETTLE_MS = 700;
/** Interval between jump re-assertions while layout settles. */
const NAV_REASSERT_MS = 120;

/** Last document the viewer scrolled to top for (see remount note below). */
let topScrolledForDocKey: string | null = null;

function formatProgress(progress: number | null): string {
  if (progress === null) return "Loading PDF…";
  return `Loading PDF… ${Math.round(progress * 100)}%`;
}

/** Page + scale-1 point under a pointer event (for markup drawing). */
function pagePointFromEvent(
  e: React.MouseEvent,
  scale: number,
): { page: number; x: number; y: number } | null {
  const target = e.target as HTMLElement | null;
  const pageEl = target?.closest?.(".pdf-page") as HTMLElement | null;
  const pageNumber = Number(pageEl?.dataset.pageNumber);
  if (!pageEl || !Number.isFinite(pageNumber)) return null;
  const rect = pageEl.getBoundingClientRect();
  return {
    page: pageNumber,
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top) / scale,
  };
}

const FREEHAND_MIN_DIST = 2.5;
const FREEHAND_MIN_LEN = 8;

/**
 * Main PDF reading surface: vertical page list with lazy rendering,
 * scroll-synced page tracking, zoom, fit modes and fullscreen.
 */
export function PdfViewer() {
  const numPages = usePdfStore((s) => s.numPages);
  const currentPage = usePdfStore((s) => s.currentPage);
  const scale = usePdfStore((s) => s.scale);
  const fitMode = usePdfStore((s) => s.fitMode);
  const showThumbnails = usePdfStore((s) => s.showThumbnails);
  const docKey = usePdfStore((s) => s.docKey);
  const navToken = usePdfStore((s) => s.navToken);
  const fsToken = usePdfStore((s) => s.fsToken);
  const isFullscreen = usePdfStore((s) => s.isFullscreen);
  const status = usePdfStore((s) => s.status);
  const loadProgress = usePdfStore((s) => s.loadProgress);

  const setCurrentPage = usePdfStore((s) => s.setCurrentPage);
  const applyFit = usePdfStore((s) => s.applyFit);
  const setFullscreen = usePdfStore((s) => s.setFullscreen);
  const notify = usePdfStore((s) => s.notify);

  const areaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const [scrollSize, setScrollSize] = useState({ width: 0, height: 0 });
  const [firstPageSizePt, setFirstPageSizePt] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const prevScaleRef = useRef(scale);
  const downPos = useRef<{ x: number; y: number } | null>(null);

  // Highlights + markups belong to the open document: load on
  // open/switch, clear on close/unmount. Restored overlays render as
  // soon as pages paint. The PDF bytes themselves are never modified.
  const fileName = usePdfStore((s) => s.fileName);
  const filePath = usePdfStore((s) => s.filePath);
  const fileSize = usePdfStore((s) => s.fileSize);
  const docId = fileName
    ? makeRecentId(filePath ?? "", fileName, fileSize ?? 0)
    : null;
  useEffect(() => {
    if (!docId) return;
    useHighlightStore.getState().loadForDoc(docId);
    useMarkupStore.getState().loadForDoc(docId);
    return () => {
      useHighlightStore.getState().clear();
      useHighlightUi.getState().closeAll();
      useMarkupStore.getState().clear();
      useMarkupUi.getState().closeAll();
    };
  }, [docId]);

  // Batch 7: search state follows the open document; bookmarks load once
  // and persist across documents (flat list, filtered per doc).
  const resetSearch = useSearchStore((s) => s.resetForDoc);
  useEffect(() => {
    if (docKey) resetSearch(docKey, usePdfStore.getState().numPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);
  useEffect(() => {
    resetSearch(usePdfStore.getState().docKey, numPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);
  useEffect(() => {
    if (!useBookmarkStore.getState().loaded) useBookmarkStore.getState().load();
  }, []);

  const markupTool = useMarkupUi((s) => s.tool);
  const drawingRef = useRef<{
    page: number;
    startClient: { x: number; y: number };
  } | null>(null);

  const pages = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  );

  // Page-element registry housekeeping. NOTE: this must NEVER blanket-clear
  // the map: ref callbacks attach during commit (before passive effects),
  // so clearing here would wipe freshly registered targets and break every
  // programmatic jump after a library → viewer remount (the scroll-sync
  // observer then wins and the view sticks to page 1). Only stale entries
  // for pages beyond the current document are pruned; same-document
  // remounts re-register identical refs and are kept as-is.
  useEffect(() => {
    setScrollRoot(scrollRef.current);
    const n = usePdfStore.getState().numPages;
    for (const key of Array.from(pageEls.current.keys())) {
      if (key < 1 || key > n) pageEls.current.delete(key);
    }
    setFirstPageSizePt(null);
    prevScaleRef.current = usePdfStore.getState().scale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Track the scroll container size for fit calculations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setScrollSize((prev) => {
        const next = { width: el.clientWidth, height: el.clientHeight };
        return prev.width === next.width && prev.height === next.height
          ? prev
          : next;
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [docKey, showThumbnails, isFullscreen]);

  // Fit-to-width / fit-to-page: derive scale from available space.
  useEffect(() => {
    if (firstPageSizePt) {
      applyFit(
        scrollSize.width,
        scrollSize.height,
        firstPageSizePt.width,
        firstPageSizePt.height,
      );
    }
  }, [fitMode, scrollSize, firstPageSizePt, applyFit]);

  const registerRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el);
    else pageEls.current.delete(page);
  }, []);

  const handleFirstPageMeasured = useCallback(
    (size: { width: number; height: number }) => {
      setFirstPageSizePt((prev) =>
        prev && prev.width === size.width && prev.height === size.height
          ? prev
          : size,
      );
    },
    [],
  );

  // Scroll-synced current page: the most visible page wins — except right
  // after a programmatic jump, when transient layout shifts (skipped pages
  // expanding/collapsing under content-visibility) can briefly expose the
  // wrong page. The jump target wins for a short window; steady-state
  // scroll tracking resumes automatically afterwards.
  const suppressSyncUntil = useRef(0);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;

    let raf = 0;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (Number.isFinite(page)) ratios.set(page, entry.intersectionRatio);
        }
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (Date.now() < suppressSyncUntil.current) return;
          let best = -1;
          let bestRatio = 0;
          for (const [page, ratio] of ratios) {
            if (ratio > bestRatio) {
              bestRatio = ratio;
              best = page;
            }
          }
          if (best > 0) setCurrentPage(best);
        });
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    // Observe after paint so refs are registered.
    const frame = requestAnimationFrame(() => {
      for (const el of pageEls.current.values()) observer.observe(el);
    });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [pages, docKey, setCurrentPage]);

  // Marks the start of a programmatic-jump quiet window for the observer.
  useEffect(() => {
    if (navToken !== 0) suppressSyncUntil.current = Date.now() + NAV_SETTLE_MS;
  }, [navToken]);

  // Programmatic navigation (toolbar / thumbnails / page box / keyboard /
  // bookmarks / notes / search). A single scrollIntoView can undershoot when
  // skipped pages expand under content-visibility mid-scroll, so the target
  // is forced visible first and the scroll is re-asserted as layout settles.
  useEffect(() => {
    if (navToken === 0) return;
    const token = navToken;
    const jump = () => {
      const page = usePdfStore.getState().currentPage;
      const el = pageEls.current.get(page);
      if (!el) return;
      // Force real geometry for the target before measuring the jump.
      const slot = el.closest(".pdf-page-slot") as HTMLElement | null;
      if (slot) slot.style.contentVisibility = "visible";
      el.scrollIntoView({ behavior: "auto", block: "start" });
      return slot;
    };
    const firstSlot = jump();
    // Re-assert twice while layout settles; bail on a newer navigation.
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (usePdfStore.getState().navToken !== token) {
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      const slot = jump();
      if (attempts >= 2) {
        window.clearInterval(timer);
        // Restore skipping for jump targets (keeps large PDFs light); the
        // first slot reference is released here as well.
        for (const s of [firstSlot, slot]) {
          if (s) s.style.contentVisibility = "";
        }
      }
    }, NAV_REASSERT_MS);
    return () => {
      window.clearInterval(timer);
      if (firstSlot) firstSlot.style.contentVisibility = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken]);

  // Fresh document → start at the top.
  // Module-level (deliberately NOT a ref): remounts create fresh refs, yet
  // a same-document remount (library → viewer) must NOT reset the scroll —
  // jumps issued before the remount (bookmarks / notes / search) already
  // set the target page, and this effect runs AFTER the nav effect, so an
  // unconditional scrollTo(top) would clobber every such jump and strand
  // the view on page 1. New documents scroll to top; remounts restore the
  // current page instead.
  useEffect(() => {
    if (topScrolledForDocKey !== docKey) {
      topScrolledForDocKey = docKey;
      scrollRef.current?.scrollTo({ top: 0 });
    } else {
      const el = pageEls.current.get(usePdfStore.getState().currentPage);
      el?.scrollIntoView({ behavior: "auto", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // --- Markup drawing + text selection → toolbars / editors ------------
  const handleMouseDown = (e: React.MouseEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
    const mk = useMarkupUi.getState();

    // Draw tools arm a draft on page press; text selection is suppressed
    // (preventDefault) so the drag draws instead of selecting. Underline /
    // strikethrough tools keep native selection — mouseup converts it.
    if (mk.tool !== "select" && !isTextMarkupTool(mk.tool)) {
      const scale = usePdfStore.getState().scale;
      const pt = pagePointFromEvent(e, scale);
      if (!pt) return;
      e.preventDefault();
      drawingRef.current = {
        page: pt.page,
        startClient: { x: e.clientX, y: e.clientY },
      };
      if (mk.tool === "rect" || mk.tool === "ellipse") {
        mk.setDraft({ kind: mk.tool, page: pt.page, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      } else if (mk.tool === "arrow") {
        mk.setDraft({ kind: "arrow", page: pt.page, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      } else if (mk.tool === "freehand") {
        mk.setDraft({ kind: "freehand", page: pt.page, points: [{ x: pt.x, y: pt.y }] });
      }
      // "text" tool: click position is consumed on mouseup (dialog).
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const mk = useMarkupUi.getState();
    const drag = drawingRef.current;
    if (!drag || !mk.draft) return;
    if (mk.tool === "text" || isTextMarkupTool(mk.tool) || mk.tool === "select") return;
    const scale = usePdfStore.getState().scale;
    const pt = pagePointFromEvent(e, scale);
    if (!pt || pt.page !== drag.page) return;
    const draft = mk.draft;
    if (draft.kind === "rect" || draft.kind === "ellipse") {
      mk.setDraft({ ...draft, x1: pt.x, y1: pt.y });
    } else if (draft.kind === "arrow") {
      mk.setDraft({ ...draft, x2: pt.x, y2: pt.y });
    } else if (draft.kind === "freehand") {
      const last = draft.points[draft.points.length - 1];
      if (!last) return;
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < FREEHAND_MIN_DIST) return;
      const points = [...draft.points, { x: pt.x, y: pt.y }].slice(-1000);
      mk.setDraft({ ...draft, points });
    }
  };

  /** Commits the in-progress draft (if any) to the markup store. */
  const commitDraft = (): boolean => {
    const mk = useMarkupUi.getState();
    const drag = drawingRef.current;
    drawingRef.current = null;
    const draft = mk.draft;
    mk.setDraft(null);
    if (!draft || !drag) return false;
    const docId = fileName
      ? makeRecentId(filePath ?? "", fileName, fileSize ?? 0)
      : null;
    if (!docId) return true;
    const { color, stroke } = mk;
    if (draft.kind === "rect" || draft.kind === "ellipse") {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      if (w >= 6 && h >= 6) {
        useMarkupStore.getState().addShape(docId, { kind: draft.kind, page: draft.page, x, y, w, h }, { color, stroke });
      }
    } else if (draft.kind === "arrow") {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= 8) {
        useMarkupStore.getState().addShape(
          docId,
          { kind: "arrow", page: draft.page, x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2 },
          { color, stroke },
        );
      }
    } else if (draft.kind === "freehand") {
      let length = 0;
      for (let i = 1; i < draft.points.length; i++) {
        length += Math.hypot(
          draft.points[i].x - draft.points[i - 1].x,
          draft.points[i].y - draft.points[i - 1].y,
        );
      }
      if (draft.points.length >= 2 && length >= FREEHAND_MIN_LEN) {
        useMarkupStore.getState().addShape(
          docId,
          { kind: "freehand", page: draft.page, points: draft.points },
          { color, stroke },
        );
      }
    }
    clearDomSelection();
    return true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const ui = useHighlightUi.getState();
    const mk = useMarkupUi.getState();
    const start = downPos.current;
    downPos.current = null;

    // A draw-tool drag just ended → persist the shape, skip everything else.
    if (drawingRef.current && mk.tool !== "select" && !isTextMarkupTool(mk.tool)) {
      // Text tool: plain click places the text dialog; a drag does nothing.
      if (mk.tool === "text") {
        const drag = drawingRef.current;
        drawingRef.current = null;
        const moved =
          start != null ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 99;
        if (moved < 5 && drag) {
          const scale = usePdfStore.getState().scale;
          const pt = pagePointFromEvent(e, scale);
          if (pt && pt.page === drag.page) {
            mk.openTextDraft({ page: pt.page, x: Math.max(0, pt.x), y: Math.max(0, pt.y) });
          }
        }
        return;
      }
      commitDraft();
      ui.hideSelection();
      return;
    }
    drawingRef.current = null;

    // Underline / strikethrough tool: convert the text selection directly.
    if (isTextMarkupTool(mk.tool)) {
      const captured = captureSelection(usePdfStore.getState().scale);
      clearDomSelection();
      ui.hideSelection();
      if (captured.length > 0) {
        const docId = fileName
          ? makeRecentId(filePath ?? "", fileName, fileSize ?? 0)
          : null;
        if (docId) {
          useMarkupStore
            .getState()
            .addFromSelection(docId, mk.tool, mk.color, mk.stroke, captured);
        }
      }
      return;
    }

    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;

    if (collapsed) {
      ui.hideSelection();
      // Plain click (not a drag) on an existing highlight opens its editor.
      // Quads are pointer-events:none, so hit-testing is geometric: the
      // click point is mapped into scale-1 quad space of the clicked page.
      // Underlines / strikethroughs share that treatment.
      if (start) {
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (moved < 5) {
          const target = e.target as HTMLElement | null;
          // Shape/text markups stop propagation on their own elements, so
          // reaching here means the click landed on page content.
          if ((target?.closest?.("[data-markup-id]") as HTMLElement | null)) return;
          const pageEl = target?.closest?.(".pdf-page") as HTMLElement | null;
          const pageNumber = Number(pageEl?.dataset.pageNumber);
          if (pageEl && Number.isFinite(pageNumber)) {
            const rect = pageEl.getBoundingClientRect();
            const scale = usePdfStore.getState().scale;
            const TOL = 2; // css px tolerance around each quad
            const hit = useHighlightStore
              .getState()
              .highlights.find(
                (h) =>
                  h.page === pageNumber &&
                  h.quads.some((q) => {
                    const left = rect.left + q.left * scale;
                    const top = rect.top + q.top * scale;
                    return (
                      e.clientX >= left - TOL &&
                      e.clientX <= left + q.width * scale + TOL &&
                      e.clientY >= top - TOL &&
                      e.clientY <= top + q.height * scale + TOL
                    );
                  }),
              );
            if (hit) {
              ui.openEditor({ highlightId: hit.id, x: e.clientX, y: e.clientY });
              return;
            }
            const mkHit = useMarkupStore
              .getState()
              .markups.find(
                (m) =>
                  m.page === pageNumber &&
                  (m.kind === "underline" || m.kind === "strike") &&
                  m.quads.some((q) => {
                    const left = rect.left + q.left * scale;
                    const top = rect.top + q.top * scale;
                    return (
                      e.clientX >= left - TOL &&
                      e.clientX <= left + q.width * scale + TOL &&
                      e.clientY >= top - TOL &&
                      e.clientY <= top + q.height * scale + TOL
                    );
                  }),
              );
            if (mkHit) {
              useMarkupUi.getState().select(mkHit.id, { x: e.clientX, y: e.clientY });
            }
          }
        }
      }
      return;
    }

    // Non-collapsed selection (mouse drag, double-click word, etc.).
    const captured = captureSelection(usePdfStore.getState().scale);
    if (captured.length === 0) {
      ui.hideSelection();
      return;
    }
    const anchorRect = getSelectionAnchorRect();
    if (!anchorRect) {
      ui.hideSelection();
      return;
    }
    ui.showSelection(captured, anchorFromRect(anchorRect));
  };

  // Preserve the reading position across zoom changes: page heights scale
  // linearly, so scaling the scroll offset keeps the same content in view.
  useEffect(() => {
    const prev = prevScaleRef.current;
    prevScaleRef.current = scale;
    if (prev <= 0 || prev === scale) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = (el.scrollTop * scale) / prev;
  }, [scale]);

  // Ctrl/Cmd + mouse wheel → zoom (also covers trackpad pinch gestures).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastZoom = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastZoom < WHEEL_ZOOM_THROTTLE_MS) return;
      lastZoom = now;
      const store = usePdfStore.getState();
      if (e.deltaY < 0) store.zoomIn();
      else if (e.deltaY > 0) store.zoomOut();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [docKey]);

  // Keyboard navigation. Bound once; reads live state to avoid rebinding.
  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      const store = usePdfStore.getState();
      const search = useSearchStore.getState();
      if (e.key === "Escape") {
        // Close search first so Esc reliably exits one layer at a time.
        if (search.isOpen) {
          search.close();
          return;
        }
        useHighlightUi.getState().closeAll();
        useNoteUi.getState().closeAll();
        useMarkupUi.getState().closeAll();
        return;
      }
      // In-document search navigation works even from the search box.
      if (e.key === "F3") {
        if (store.screen !== "viewer") return;
        e.preventDefault();
        if (e.shiftKey) search.prev();
        else search.next();
        return;
      }
      // Search + bookmark shortcuts work even when an input is focused
      // (except browser-reserved keys handled below by the editable guard).
      const earlyMod = e.ctrlKey || e.metaKey;
      if (earlyMod && (e.key === "f" || e.key === "F")) {
        if (store.screen !== "viewer") return;
        // Real in-document search (Batch 7): opens the floating bar.
        e.preventDefault();
        search.open();
        return;
      }
      if (store.screen !== "viewer" || isEditable(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === "=" || e.key === "+" || e.key === "-")) {
        e.preventDefault();
        if (e.key === "-") store.zoomOut();
        else store.zoomIn();
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        usePdfStore.getState().setScale(1);
        return;
      }
      if (mod && (e.key === "d" || e.key === "D")) {
        // Bookmark the current page (Batch 7). Prevent the browser's
        // own bookmark dialog.
        e.preventDefault();
        useBookmarkStore.getState().toggleCurrentPage();
        return;
      }
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        const name = store.fileName;
        if (!name || store.status !== "ready") return;
        void saveCurrentPdfCopy(name)
          .then((result) => {
            if (result === "saved") store.notify(`Saved a copy of ${name}.`);
          })
          .catch(() =>
            store.notify("Could not save the PDF. Please try again."),
          );
        return;
      }
      if (mod) return;

      switch (e.key) {
        case "PageDown":
          e.preventDefault();
          store.nextPage();
          break;
        case "PageUp":
          e.preventDefault();
          store.prevPage();
          break;
        case "Home":
          e.preventDefault();
          store.goToPage(1);
          break;
        case "End":
          e.preventDefault();
          store.goToPage(store.numPages);
          break;
        case "ArrowRight":
          // Horizontal arrows flip pages; vertical arrows keep native
          // scrolling so keyboard users can still read line by line.
          e.preventDefault();
          store.nextPage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          store.prevPage();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fullscreen: the viewer area becomes the fullscreen element, so the
  // sidebar/toolbar chrome disappears and the PDF takes the whole screen.
  useEffect(() => {
    if (fsToken === 0) return;
    const el = areaRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (el.requestFullscreen) {
      void el
        .requestFullscreen()
        .catch(() => notify("Fullscreen is not available."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsToken]);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [setFullscreen]);

  // Leaving the viewer (close) always exits fullscreen first.
  useEffect(() => {
    if (status === "idle" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [status]);

  if (!docKey || numPages === 0) return null;

  // Scroll-margin compensates for the page gap so scrolled-to pages align.
  const scrollMargin = Math.floor(PAGE_GAP / 1);

  return (
    <div ref={areaRef} className="viewer-area">
      <SearchBar />
      {showThumbnails && (
        <ThumbnailPanel
          numPages={numPages}
          currentPage={currentPage}
          docKey={docKey}
        />
      )}
      <div
        ref={scrollRef}
        className={`pdf-scroll${markupTool !== "select" ? " is-drawing" : ""}`}
        role="document"
        aria-label={`PDF document, ${numPages} pages`}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {status === "loading" && (
          <div className="viewer-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {formatProgress(loadProgress)}
          </div>
        )}
        {pages.map((page) => (
          <div
            key={`${docKey}:${page}`}
            className="pdf-page-slot"
            style={{ scrollMarginTop: scrollMargin }}
          >
            <PdfPage
              pageNumber={page}
              scale={scale}
              scrollRoot={scrollRoot}
              registerRef={registerRef}
              onFirstPageMeasured={handleFirstPageMeasured}
              docKey={docKey}
            />
          </div>
        ))}
        <div className="pdf-endmark">
          Page {currentPage} of {numPages}
        </div>
      </div>
      {isFullscreen && (
        <button
          type="button"
          className="fullscreen-exit"
          onClick={() => {
            void document.exitFullscreen().catch(() => undefined);
          }}
          title="Exit fullscreen (Esc)"
          aria-label="Exit fullscreen"
        >
          <Icon name="fullscreenExit" size={16} />
          <span>Exit fullscreen</span>
        </button>
      )}
    </div>
  );
}
