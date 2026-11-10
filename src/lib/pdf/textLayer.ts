import { pdfjsLib } from "./pdfjsSetup";
import { getPage } from "./pdfEngine";
import type { PageViewport, TextLayer } from "pdfjs-dist";

/**
 * Builds the selectable text layer for one rendered page.
 *
 * DOM structure per page:
 *
 *   .pdf-page
 *   ├── canvas            (PDF.js bitmap)
 *   ├── .pdf-text-layer   (this module — selection & copy)
 *   └── .pdf-annotation-layer (highlights/notes/markups/search)
 *
 * PDF.js owns the span layout here: it matches each span's font family,
 * ascent, width and rotation to the PDF text item, so selection and copy
 * geometry line up with the canvas at every zoom level.
 */
export async function buildTextLayer(
  pageNumber: number,
  viewport: PageViewport,
  container: HTMLElement,
  signal?: AbortSignal,
): Promise<TextLayer | null> {
  const page = await getPage(pageNumber);
  try {
    if (signal?.aborted) return null;
    const textContent = await page.getTextContent({
      includeMarkedContent: true,
    });
    if (signal?.aborted) return null;

    container.replaceChildren();
    // TextLayer resolves its CSS width/height and font sizes from these
    // variables. They must be present before the constructor runs because
    // it calls setLayerDimensions() immediately.
    container.style.setProperty(
      "--total-scale-factor",
      String(viewport.scale),
    );
    container.style.setProperty("--scale-round-x", "1px");
    container.style.setProperty("--scale-round-y", "1px");

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });

    const onAbort = () => textLayer.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await textLayer.render();
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (signal?.aborted) return null;

    // Selection capture and search both address spans by data-div-index.
    // TextLayer creates spans for empty items too, but only appends spans
    // with text, so number the connected ones in DOM order.
    let divIndex = 0;
    for (const div of textLayer.textDivs) {
      if (!div.isConnected || !div.textContent) continue;
      div.dataset.divIndex = String(divIndex);
      divIndex += 1;
    }

    return textLayer;
  } finally {
    page.cleanup();
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    String((err as { name: unknown }).name) === "AbortException"
  );
}
