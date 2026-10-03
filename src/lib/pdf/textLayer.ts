import { pdfjsLib } from "./pdfjsSetup";
import { getPage } from "./pdfEngine";
import type { PageViewport } from "pdfjs-dist";

/**
 * Builds the selectable text layer for one rendered page.
 *
 * DOM structure per page (Batch 2 ready):
 *
 *   .pdf-page
 *   ├── canvas            (PDF.js bitmap)
 *   ├── .pdf-text-layer   (this module — selection & copy)
 *   └── .pdf-annotation-layer (reserved for Batch 2: highlights/notes/draw)
 *
 * The layer is positioned 1:1 over the canvas using the same viewport,
 * so future annotation coordinates can share the identical space.
 */
export async function buildTextLayer(
  pageNumber: number,
  viewport: PageViewport,
  container: HTMLElement,
): Promise<void> {
  const page = await getPage(pageNumber);
  try {
    const textContent = await page.getTextContent();

    container.replaceChildren();
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;

    const fragment = document.createDocumentFragment();
    // divIndex mirrors the span order 1:1 so selections can later be
    // mapped back to text-layer ranges for highlight anchoring.
    let divIndex = 0;

    for (const rawItem of textContent.items) {
      if (!("str" in rawItem)) {
        // Marked-content boundary — nothing selectable to emit.
        continue;
      }
      const item = rawItem;
      if (!item.str) continue;

      // Map PDF text space into viewport (CSS pixel) space.
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      if (!Number.isFinite(fontHeight) || fontHeight <= 0) continue;

      const span = document.createElement("span");
      span.textContent = item.str;
      span.dataset.divIndex = String(divIndex);
      divIndex += 1;

      // Baseline origin: PDF positions by baseline, CSS by top-left.
      const angle = Math.atan2(tx[1], tx[0]);
      const left =
        tx[4] + (item.dir === "rtl" ? fontHeight * Math.sin(angle) : 0);
      const top = tx[5] - fontHeight;

      span.style.left = `${left}px`;
      span.style.top = `${top}px`;
      span.style.fontSize = `${fontHeight}px`;
      if (angle !== 0) {
        span.style.transform = `rotate(${angle}rad)`;
      }

      fragment.appendChild(span);

      if ("hasEOL" in item && item.hasEOL) {
        fragment.appendChild(document.createElement("br"));
      }
    }

    container.appendChild(fragment);
  } finally {
    page.cleanup();
  }
}
