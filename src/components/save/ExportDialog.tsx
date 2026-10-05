/**
 * Batch 8 — export progress + failure dialog.
 *
 * - Shows a determinate progress bar while pages are burned (critical for
 *   large PDFs: "Exporting page X of N").
 * - Failures stay in the dialog with a retry action; the original PDF is
 *   never modified and the viewer state is untouched (graceful handling).
 */

import { useSaveStore } from "@/state/saveStore";

export function ExportDialog() {
  const isExporting = useSaveStore((s) => s.isExporting);
  const ratio = useSaveStore((s) => s.exportRatio);
  const phase = useSaveStore((s) => s.exportPhase);
  const page = useSaveStore((s) => s.exportPage);
  const total = useSaveStore((s) => s.exportTotal);
  const exportError = useSaveStore((s) => s.exportError);
  const exportPdf = useSaveStore((s) => s.exportPdf);
  const cancelExportError = useSaveStore((s) => s.cancelExportError);

  if (!isExporting && !exportError) return null;

  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const phaseLabel =
    phase === "load" ? "Reading PDF…"
    : phase === "save" ? "Writing file…"
    : total > 0
      ? `Exporting page ${Math.max(1, page)} of ${total}…`
      : "Exporting…";

  return (
    <div className="export-overlay" role="presentation">
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={exportError ? "Export failed" : "Exporting annotated PDF"}
        aria-busy={isExporting}
      >
        {exportError ? (
          <>
            <h2 className="export-title">Export failed</h2>
            <p className="export-message" role="alert">
              {exportError}
            </p>
            <p className="muted small">The original PDF was not modified. Your annotations are still safe.</p>
            <div className="export-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  cancelExportError();
                  void exportPdf();
                }}
                autoFocus
              >
                Retry export
              </button>
              <button type="button" className="btn" onClick={cancelExportError}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="export-title">Exporting annotated PDF</h2>
            <p className="export-message">{phaseLabel}</p>
            <div
              className="export-bar"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="export-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="muted small">
              {pct}%{total > 0 && phase === "render" ? ` · page ${page} of ${total}` : ""} — the
              original file is left untouched.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
