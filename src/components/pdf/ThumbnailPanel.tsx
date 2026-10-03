import { memo, useEffect, useRef, useState } from "react";
import { getPage, renderThumbnailToCanvas } from "@/lib/pdf/pdfEngine";
import { usePdfStore } from "@/state/pdfStore";
import type { RenderTask } from "pdfjs-dist";

interface ThumbnailItemProps {
  pageNumber: number;
  isActive: boolean;
  scrollRoot: Element | null;
  docKey: string;
}

const THUMB_WIDTH = 124;

const ThumbnailItem = memo(function ThumbnailItem({
  pageNumber,
  isActive,
  scrollRoot,
  docKey,
}: ThumbnailItemProps) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const goToPage = usePdfStore((s) => s.goToPage);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === el && entry.isIntersecting) {
            setNearViewport(true);
          }
        }
      },
      { root: scrollRoot, rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot, pageNumber, docKey]);

  useEffect(() => {
    if (!nearViewport) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      try {
        const page = await getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        task = renderThumbnailToCanvas(page, canvas, THUMB_WIDTH).task;
        await task.promise;
        page.cleanup();
      } catch {
        // Cancelled or failed thumbnail — placeholder remains.
      }
    })();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        // Already finished.
      }
    };
  }, [nearViewport, pageNumber, docKey]);

  // Reset the "seen" flag for a newly opened document.
  useEffect(() => {
    setNearViewport(false);
  }, [docKey]);

  return (
    <button
      ref={wrapRef}
      type="button"
      className={`thumb-item${isActive ? " is-active" : ""}`}
      onClick={() => goToPage(pageNumber)}
      title={`Go to page ${pageNumber}`}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={isActive ? "true" : undefined}
    >
      <span className="thumb-canvas-wrap">
        <canvas ref={canvasRef} className="thumb-canvas" />
        {!nearViewport && <span className="thumb-skeleton" />}
      </span>
      <span className="thumb-label">{pageNumber}</span>
    </button>
  );
});

interface ThumbnailPanelProps {
  numPages: number;
  currentPage: number;
  docKey: string;
}

export function ThumbnailPanel({ numPages, currentPage, docKey }: ThumbnailPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  useEffect(() => {
    setScrollRoot(listRef.current);
  }, []);

  // Keep the active thumbnail in view (only when it drifts far away,
  // so scroll-syncing never fights the user).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".thumb-item.is-active");
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.top - listRect.top - listRect.height / 2 + itemRect.height / 2;
    }
  }, [currentPage]);

  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <aside className="thumb-panel" aria-label="Page thumbnails">
      <div ref={listRef} className="thumb-list" role="list">
        {pages.map((page) => (
          <ThumbnailItem
            key={`${docKey}:${page}`}
            pageNumber={page}
            isActive={page === currentPage}
            scrollRoot={scrollRoot}
            docKey={docKey}
          />
        ))}
      </div>
    </aside>
  );
}
