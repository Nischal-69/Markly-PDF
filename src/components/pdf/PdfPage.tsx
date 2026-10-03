import { useEffect, useRef, useState } from "react";
import {
  getPage,
  getPageDimensions,
  renderPageToCanvas,
} from "@/lib/pdf/pdfEngine";
import { buildTextLayer } from "@/lib/pdf/textLayer";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";

interface PdfPageProps {
  pageNumber: number;
  scale: number;
  /** Scroll container used as the IntersectionObserver root. */
  scrollRoot: Element | null;
  registerRef: (page: number, el: HTMLDivElement | null) => void;
  onFirstPageMeasured: (size: { width: number; height: number }) => void;
  docKey: string;
}

const FALLBACK_ASPECT = 297 / 210; // A4 portrait until measured.

/**
 * One PDF page: canvas bitmap + selectable text layer + a reserved
 * annotation-layer slot for Batch 2 (highlights / notes / drawing).
 */
export function PdfPage({
  pageNumber,
  scale,
  scrollRoot,
  registerRef,
  onFirstPageMeasured,
  docKey,
}: PdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [nearViewport, setNearViewport] = useState(false);
  const [sizePt, setSizePt] = useState<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Measure page size once per document (cheap, no rendering).
  useEffect(() => {
    let alive = true;
    setSizePt(null);
    setNearViewport(false);
    setRenderError(false);
    getPageDimensions(pageNumber)
      .then((dims) => {
        if (!alive) return;
        setSizePt(dims);
        if (pageNumber === 1) onFirstPageMeasured(dims);
      })
      .catch(() => {
        if (alive) setSizePt({ width: 595, height: 842 });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, docKey]);

  // Lazy rendering: only pages near the viewport get full-resolution output.
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
      { root: scrollRoot, rootMargin: "900px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot, pageNumber, docKey]);

  // Render canvas + text layer whenever visibility, scale or doc changes.
  useEffect(() => {
    if (!nearViewport || !sizePt) return;
    const canvas = canvasRef.current;
    const textLayer = textRef.current;
    if (!canvas || !textLayer) return;

    let cancelled = false;
    let task: RenderTask | null = null;
    let page: PDFPageProxy | null = null;

    setRenderError(false);

    (async () => {
      try {
        page = await getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }
        const { task: renderTask, viewport } = renderPageToCanvas(page, canvas, scale);
        task = renderTask;
        await renderTask.promise;
        if (cancelled) return;
        await buildTextLayer(pageNumber, viewport, textLayer);
        if (cancelled) return;
        page.cleanup();
      } catch (err) {
        // Cancelled renders reject with RenderingCancelledException — silent.
        const name =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (!cancelled && name !== "RenderingCancelledException") {
          setRenderError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        // Already finished — nothing to cancel.
      }
      if (page) {
        try {
          page.cleanup();
        } catch {
          // Best effort.
        }
      }
    };
  }, [nearViewport, scale, sizePt, pageNumber, docKey, retryToken]);

  const cssWidth = (sizePt?.width ?? 595) * scale;
  const cssHeight = sizePt
    ? sizePt.height * scale
    : 595 * FALLBACK_ASPECT * scale;
  const pageLabel = `Page ${pageNumber}`;

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        registerRef(pageNumber, el);
      }}
      className="pdf-page"
      data-page-number={pageNumber}
      aria-label={pageLabel}
      style={{ width: cssWidth, height: cssHeight }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textRef} className="pdf-text-layer" aria-hidden={false} />
      {/* Batch 2 reservation: highlights, notes and drawing mount here,
          sharing the exact viewport coordinate space above. */}
      <div
        className="pdf-annotation-layer"
        data-annotation-layer={pageNumber}
      />
      {!nearViewport && !renderError && <div className="pdf-page-skeleton" />}
      {renderError && (
        <div className="pdf-page-error" role="alert">
          <span>Could not render {pageLabel.toLowerCase()}.</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => setRetryToken((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
