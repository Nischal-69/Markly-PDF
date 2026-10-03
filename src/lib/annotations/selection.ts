import type {
  CapturedPageSelection,
  HighlightQuad,
} from "./highlightTypes";

const MIN_RECT_SIZE = 1;

/**
 * Range overlap via `comparePoint` (point-in-range), deliberately NOT
 * `compareBoundaryPoints`, which misbehaves for nested boundaries in
 * Chromium (verified empirically: strictly-contained ranges report
 * inverted results, while comparePoint is exact).
 */
function containsPoint(range: Range, node: Node, offset: number): boolean {
  try {
    return range.comparePoint(node, offset) === 0;
  } catch {
    return false;
  }
}

function rangesOverlap(a: Range, b: Range): boolean {
  return (
    containsPoint(a, b.startContainer, b.startOffset) ||
    containsPoint(a, b.endContainer, b.endOffset) ||
    containsPoint(b, a.startContainer, a.startOffset)
  );
}

function clampTo(range: Range, bounds: Range): Range | null {
  const startsInBounds = containsPoint(
    bounds,
    range.startContainer,
    range.startOffset,
  );
  const endsInBounds = containsPoint(
    bounds,
    range.endContainer,
    range.endOffset,
  );
  if (
    !startsInBounds &&
    !endsInBounds &&
    !containsPoint(range, bounds.startContainer, bounds.startOffset)
  ) {
    return null;
  }
  const sub = range.cloneRange();
  if (!startsInBounds) sub.setStart(bounds.startContainer, bounds.startOffset);
  if (!endsInBounds) sub.setEnd(bounds.endContainer, bounds.endOffset);
  return sub.collapsed ? null : sub;
}

/**
 * Captures the current user selection as per-page highlight data.
 *
 * Each `.pdf-page` contributes at most one entry: the selected text on
 * that page plus scale-1 quads measured from the live text-layer spans.
 * Cross-page selections therefore yield one highlight per touched page.
 *
 * Returns an empty array when there is no usable text selection inside
 * the viewer (collapsed caret, selection in inputs/toolbars, etc.).
 */
export function captureSelection(scale: number): CapturedPageSelection[] {
  if (!(scale > 0)) return [];
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];

  const range = sel.getRangeAt(0).cloneRange();
  if (range.collapsed) return [];

  // The selection must live inside the viewer — never in toolbars/inputs.
  const viewer = document.querySelector(".pdf-scroll");
  if (
    !viewer ||
    !range.startContainer ||
    !range.endContainer ||
    !(viewer.contains(range.startContainer) && viewer.contains(range.endContainer))
  ) {
    return [];
  }

  const result: CapturedPageSelection[] = [];
  const pages = viewer.querySelectorAll(":scope .pdf-page");

  pages.forEach((pageEl) => {
    const htmlPage = pageEl as HTMLElement;
    const pageNumber = Number(htmlPage.dataset.pageNumber);
    if (!Number.isFinite(pageNumber)) return;

    const textLayer = htmlPage.querySelector(".pdf-text-layer");
    if (!textLayer) return;

    const pageRange = document.createRange();
    pageRange.selectNodeContents(textLayer);
    if (!rangesOverlap(range, pageRange)) return;

    const spans = Array.from(
      textLayer.querySelectorAll("span[data-div-index]"),
    );
    if (spans.length === 0) return;

    const pageRect = htmlPage.getBoundingClientRect();
    const quads: HighlightQuad[] = [];
    let beginDiv = -1;
    let beginOffset = 0;
    let endDiv = -1;
    let endOffset = 0;
    const textParts: string[] = [];

    spans.forEach((span) => {
      const spanEl = span as HTMLElement;
      const divIndex = Number(spanEl.dataset.divIndex);
      if (!Number.isFinite(divIndex)) return;

      const spanRange = document.createRange();
      spanRange.selectNodeContents(spanEl);
      const sub = clampTo(range, spanRange);
      if (!sub) return;

      const spanText = spanEl.textContent ?? "";
      // Offsets are only meaningful when the boundary sits in a text node;
      // a drag started/ended in a line gap anchors at the span edge instead.
      const startsHere =
        spanEl.contains(range.startContainer) &&
        range.startContainer.nodeType === Node.TEXT_NODE;
      const endsHere =
        spanEl.contains(range.endContainer) &&
        range.endContainer.nodeType === Node.TEXT_NODE;
      const from = startsHere
        ? Math.min(range.startOffset, spanText.length)
        : 0;
      const to = endsHere ? Math.min(range.endOffset, spanText.length) : spanText.length;

      if (beginDiv === -1) {
        beginDiv = divIndex;
        beginOffset = from;
      }
      endDiv = divIndex;
      endOffset = to;
      textParts.push(spanText.slice(from, to));

      const rects = sub.getClientRects();
      for (const rect of Array.from(rects)) {
        if (rect.width < MIN_RECT_SIZE || rect.height < MIN_RECT_SIZE) {
          continue;
        }
        quads.push({
          left: (rect.left - pageRect.left) / scale,
          top: (rect.top - pageRect.top) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        });
      }
    });

    const text = textParts.join("");
    if (beginDiv === -1 || quads.length === 0 || text.trim() === "") return;

    result.push({
      page: pageNumber,
      text,
      range: { beginDiv, beginOffset, endDiv, endOffset },
      quads,
    });
  });

  return result;
}

/** Bounding client rect of the live selection (for toolbar anchoring). */
export function getSelectionAnchorRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return rect;
}

export function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges();
}
