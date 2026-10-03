import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { openPdfFromDisk } from "@/lib/files/fileHandling";
import { MAX_SCALE, MIN_SCALE, usePdfStore } from "@/state/pdfStore";

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function TopToolbar() {
  const status = usePdfStore((s) => s.status);
  const screen = usePdfStore((s) => s.screen);
  const fileName = usePdfStore((s) => s.fileName);
  const numPages = usePdfStore((s) => s.numPages);
  const currentPage = usePdfStore((s) => s.currentPage);
  const scale = usePdfStore((s) => s.scale);
  const fitToWidth = usePdfStore((s) => s.fitToWidth);
  const showThumbnails = usePdfStore((s) => s.showThumbnails);

  const openPdf = usePdfStore((s) => s.openPdf);
  const closeDocument = usePdfStore((s) => s.closeDocument);
  const goToPage = usePdfStore((s) => s.goToPage);
  const nextPage = usePdfStore((s) => s.nextPage);
  const prevPage = usePdfStore((s) => s.prevPage);
  const zoomIn = usePdfStore((s) => s.zoomIn);
  const zoomOut = usePdfStore((s) => s.zoomOut);
  const resetZoom = usePdfStore((s) => s.resetZoom);
  const setFitToWidth = usePdfStore((s) => s.setFitToWidth);
  const toggleThumbnails = usePdfStore((s) => s.toggleThumbnails);

  const [opening, setOpening] = useState(false);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);

  const inViewer = screen === "viewer";
  const busy = status === "loading";

  // Keep the page box in sync while the user is not editing it.
  useEffect(() => {
    if (pageDraft === null && pageInputRef.current) {
      pageInputRef.current.value = String(currentPage);
    }
  }, [currentPage, pageDraft]);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const picked = await openPdfFromDisk();
      if (picked) await openPdf(picked);
    } finally {
      setOpening(false);
    }
  };

  const commitPage = () => {
    const raw = pageInputRef.current?.value ?? "";
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) goToPage(parsed);
    setPageDraft(null);
    pageInputRef.current?.blur();
  };

  return (
    <header className="toolbar" aria-label="Markly PDF toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleOpen}
          disabled={opening || busy}
          title="Open a PDF from this computer"
        >
          <Icon name="open" size={15} />
          <span>{opening || busy ? "Opening…" : "Open PDF"}</span>
        </button>

        {inViewer && fileName && (
          <div className="toolbar-doc" title={fileName}>
            <Icon name="file" size={15} />
            <span className="toolbar-doc-name">{fileName}</span>
          </div>
        )}
      </div>

      <div className="toolbar-group toolbar-center" aria-label="Page navigation">
        <button
          type="button"
          className="btn btn-icon"
          onClick={prevPage}
          disabled={!inViewer || currentPage <= 1}
          title="Previous page"
          aria-label="Previous page"
        >
          <Icon name="chevronLeft" size={16} />
        </button>

        <span className="page-box">
          <input
            ref={pageInputRef}
            className="page-input"
            defaultValue={currentPage}
            inputMode="numeric"
            aria-label="Current page number"
            disabled={!inViewer}
            onFocus={(e) => {
              setPageDraft(e.currentTarget.value);
              e.currentTarget.select();
            }}
            onChange={(e) => setPageDraft(e.currentTarget.value)}
            onBlur={commitPage}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPage();
              if (e.key === "Escape") {
                setPageDraft(null);
                e.currentTarget.blur();
              }
            }}
          />
          <span className="page-total">/ {inViewer ? numPages : "–"}</span>
        </span>

        <button
          type="button"
          className="btn btn-icon"
          onClick={nextPage}
          disabled={!inViewer || currentPage >= numPages}
          title="Next page"
          aria-label="Next page"
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <div className="toolbar-group" aria-label="Zoom controls">
        <button
          type="button"
          className="btn btn-icon"
          onClick={zoomOut}
          disabled={!inViewer || scale <= MIN_SCALE}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Icon name="minus" size={15} />
        </button>

        <button
          type="button"
          className="zoom-label"
          onClick={resetZoom}
          disabled={!inViewer}
          title="Reset zoom to 100%"
        >
          {inViewer ? formatZoom(scale) : "–"}
        </button>

        <button
          type="button"
          className="btn btn-icon"
          onClick={zoomIn}
          disabled={!inViewer || scale >= MAX_SCALE}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Icon name="plus" size={15} />
        </button>

        <button
          type="button"
          className={`btn btn-icon${fitToWidth && inViewer ? " is-active" : ""}`}
          onClick={() => setFitToWidth(!fitToWidth)}
          disabled={!inViewer}
          title={fitToWidth ? "Fit-to-width is on" : "Fit page to width"}
          aria-label="Fit page to width"
          aria-pressed={fitToWidth && inViewer}
        >
          <Icon name="fitWidth" size={15} />
        </button>

        <span className="toolbar-sep" />

        <button
          type="button"
          className={`btn btn-icon${showThumbnails && inViewer ? " is-active" : ""}`}
          onClick={toggleThumbnails}
          disabled={!inViewer}
          title="Toggle page thumbnails"
          aria-label="Toggle page thumbnails"
          aria-pressed={showThumbnails && inViewer}
        >
          <Icon name="panel" size={15} />
        </button>

        {inViewer && (
          <button
            type="button"
            className="btn btn-icon"
            onClick={closeDocument}
            title="Close document (back to library)"
            aria-label="Close document"
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
