import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;

/**
 * Configures the PDF.js worker exactly once.
 * The worker bundle is served locally by Vite / Tauri, so the
 * application works fully offline.
 */
export function ensurePdfWorker(): void {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  workerConfigured = true;
}

export { pdfjsLib };
