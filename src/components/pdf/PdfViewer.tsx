import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PdfPage } from "./PdfPage";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { Icon } from "@/components/icons/Icon";
import {
  captureSelection,
  getSelectionAnchorRect,
} from "@/lib/annotations/selection";
import { saveCurrentPdfCopy } from "@/lib/files/fileHandling";
import { makeRecentId } from "@/lib/storage/recentFiles";
import { useHighlightStore } from "@/state/highlightStore";
import { anchorFromRect, useHighlightUi } from "@/state/highlightUi";
import { usePdfStore } from "@/state/pdfStore";

const PAGE_GAP = 16;
const WHEEL_ZOOM_THROTTLE_MS = 80;

function formatProgress(progress: number | null): string {
  if (progress === null) return "Loading PDF…";
  return `Loading PDF… ${Math.round(progress * 100)}%`;
}

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

  // Highlights belong to the open document: load on open/switch, clear
  // on close/unmount. Restored quads render as soon as pages paint.
  const fileName = usePdfStore((s) => s.fileName);
  const filePath = usePdfStore((s) => s.filePath);
  const fileSize = usePdfStore((s) => s.fileSize);
  const docId = fileName
    ? makeRecentId(filePath ?? "", fileName, fileSize ?? 0)
    : null;
  useEffect(() => {
    if (!docId) return;
    useHighlightStore.getState().loadForDoc(docId);
    return () => {
      useHighlightStore.getState().clear();
      useHighlightUi.getState().closeAll();
    };
  }, [docId]);

  const pages = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  );

  useEffect(() => {
    setScrollRoot(scrollRef.current);
    pageEls.current.clear();
    setFirstPageSizePt(null);
    prevScaleRef.current = usePdfStore.getState().scale;
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

  // Scroll-synced current page: the most visible page wins.
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

  // Programmatic navigation (toolbar / thumbnails / page box / keyboard).
  useEffect(() => {
    if (navToken === 0) return;
    const el = pageEls.current.get(usePdfStore.getState().currentPage);
    el?.scrollIntoView({ behavior: "auto", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navToken]);

  // Fresh document → start at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [docKey]);

  // --- Text selection → highlight toolbar / highlight editor ------------
  const handleMouseDown = (e: React.MouseEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const ui = useHighlightUi.getState();
    const start = downPos.current;
    downPos.current = null;

    const sel = window.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed;

    if (collapsed) {
      ui.hideSelection();
      // Plain click (not a drag) on an existing highlight opens its editor.
      // Quads are pointer-events:none, so hit-testing is geometric: the
      // click point is mapped into scale-1 quad space of the clicked page.
      if (start) {
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (moved < 5) {
          const target = e.target as HTMLElement | null;
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
      if (e.key === "Escape") {
        useHighlightUi.getState().closeAll();
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
      if (mod && (e.key === "f" || e.key === "F")) {
        // Placeholder: real in-document search lands in a later batch.
        e.preventDefault();
        store.notify("PDF search is coming in a later batch.");
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
      {showThumbnails && (
        <ThumbnailPanel
          numPages={numPages}
          currentPage={currentPage}
          docKey={docKey}
        />
      )}
      <div
        ref={scrollRef}
        className="pdf-scroll"
        role="document"
        aria-label={`PDF document, ${numPages} pages`}
        tabIndex={0}
        onMouseDown={handleMouseDown}
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
