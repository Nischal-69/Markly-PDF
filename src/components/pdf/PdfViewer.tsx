import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PdfPage } from "./PdfPage";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { usePdfStore } from "@/state/pdfStore";

const PAGE_GAP = 16;
const VIEWER_PADDING_X = 48; // matches .pdf-scroll horizontal padding

/**
 * Main PDF reading surface: vertical page list with lazy rendering,
 * scroll-synced page tracking, zoom and fit-to-width.
 */
export function PdfViewer() {
  const numPages = usePdfStore((s) => s.numPages);
  const currentPage = usePdfStore((s) => s.currentPage);
  const scale = usePdfStore((s) => s.scale);
  const fitToWidth = usePdfStore((s) => s.fitToWidth);
  const showThumbnails = usePdfStore((s) => s.showThumbnails);
  const docKey = usePdfStore((s) => s.docKey);
  const navToken = usePdfStore((s) => s.navToken);
  const status = usePdfStore((s) => s.status);

  const setCurrentPage = usePdfStore((s) => s.setCurrentPage);
  const applyFitWidth = usePdfStore((s) => s.applyFitWidth);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [firstPageWidthPt, setFirstPageWidthPt] = useState<number | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());

  const pages = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  );

  useEffect(() => {
    setScrollRoot(scrollRef.current);
    pageEls.current.clear();
    setFirstPageWidthPt(null);
  }, [docKey]);

  // Track the scroll container width for fit-to-width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [docKey, showThumbnails]);

  // Fit-to-width: derive scale from available width + page 1 width.
  useEffect(() => {
    if (fitToWidth && firstPageWidthPt) {
      applyFitWidth(scrollWidth - VIEWER_PADDING_X, firstPageWidthPt);
    }
  }, [fitToWidth, scrollWidth, firstPageWidthPt, applyFitWidth]);

  const registerRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el);
    else pageEls.current.delete(page);
  }, []);

  const handleFirstPageMeasured = useCallback((widthPt: number) => {
    setFirstPageWidthPt((prev) => (prev === widthPt ? prev : widthPt));
  }, []);

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

  // Programmatic navigation (toolbar / thumbnails / page box).
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

  if (!docKey || numPages === 0) return null;

  // Scroll-margin compensates for the page gap so scrolled-to pages align.
  const scrollMargin = Math.floor(PAGE_GAP / 1);

  return (
    <div className="viewer-area">
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
      >
        {status === "loading" && (
          <div className="viewer-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Loading PDF…
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
              firstPageWidthPt={firstPageWidthPt}
              onFirstPageMeasured={handleFirstPageMeasured}
              docKey={docKey}
            />
          </div>
        ))}
        <div className="pdf-endmark">
          Page {currentPage} of {numPages}
        </div>
      </div>
    </div>
  );
}
