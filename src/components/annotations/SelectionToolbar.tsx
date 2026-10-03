import { useEffect } from "react";
import { Icon } from "@/components/icons/Icon";
import { currentDocId } from "@/lib/annotations/docId";
import { HIGHLIGHT_COLORS } from "@/lib/annotations/highlightTypes";
import {
  clearDomSelection,
  getSelectionAnchorRect,
} from "@/lib/annotations/selection";
import { useHighlightStore } from "@/state/highlightStore";
import { anchorFromRect, useHighlightUi } from "@/state/highlightUi";
import { usePdfStore } from "@/state/pdfStore";

/**
 * Compact floating toolbar that appears next to a text selection.
 * Choosing a color stores one highlight per touched page, then clears
 * the DOM selection so the new highlight quads show through cleanly.
 */
export function SelectionToolbar() {
  const pending = useHighlightUi((s) => s.pending);
  const showSelection = useHighlightUi((s) => s.showSelection);
  const hideSelection = useHighlightUi((s) => s.hideSelection);
  const addCaptured = useHighlightStore((s) => s.addCaptured);

  const scale = usePdfStore((s) => s.scale);
  const docKey = usePdfStore((s) => s.docKey);

  // A zoom or document change rebuilds the text layer, which destroys
  // the live DOM selection — the pending capture would be stale.
  useEffect(() => {
    hideSelection();
  }, [scale, docKey, hideSelection]);

  // Follow the live selection while scrolling; hide if it collapses.
  useEffect(() => {
    if (!pending) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Skip while the user is actively dragging a new selection —
        // mouseup will capture and re-anchor precisely.
        if (useHighlightUi.getState().pending === null) return;
        const rect = getSelectionAnchorRect();
        if (!rect) {
          useHighlightUi.getState().hideSelection();
          return;
        }
        // Only move when the selection actually drifted (scroll/resize),
        // avoiding render churn from identical anchors.
        const next = anchorFromRect(rect);
        const current = useHighlightUi.getState().pending?.anchor;
        if (
          !current ||
          Math.abs(current.x - next.x) > 1 ||
          Math.abs(current.y - next.y) > 1 ||
          current.above !== next.above
        ) {
          useHighlightUi.getState().moveSelectionAnchor(next);
        }
      });
    };
    const scrollEl = document.querySelector(".pdf-scroll");
    scrollEl?.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl?.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  }, [pending !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-anchor precisely when a selection first appears (the capture-time
  // rect may predate the toolbar's own layout pass).
  const hasPending = pending !== null;
  useEffect(() => {
    if (!pending) return;
    const rect = getSelectionAnchorRect();
    if (rect) showSelection(pending.pages, anchorFromRect(rect));
    // Runs only on appear/disappear transitions by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending]);

  if (!pending) return null;

  const handlePick = (colorId: (typeof HIGHLIGHT_COLORS)[number]["id"]) => {
    const docId = currentDocId();
    if (docId) {
      addCaptured(docId, colorId, pending.pages);
    }
    clearDomSelection();
    hideSelection();
  };

  const style: React.CSSProperties = pending.anchor.above
    ? {
        left: pending.anchor.x,
        top: pending.anchor.y,
        transform: "translate(-50%, -100%)",
      }
    : {
        left: pending.anchor.x,
        top: pending.anchor.y,
        transform: "translate(-50%, 0)",
      };

  return (
    <div
      className="hl-toolbar"
      role="toolbar"
      aria-label="Highlight selection"
      style={style}
      // Don't let mousedown in the toolbar collapse the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="hl-toolbar-label">Highlight</span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className="hl-dot"
          style={{ backgroundColor: c.swatch }}
          title={`Highlight ${c.label}`}
          aria-label={`Highlight ${c.label}`}
          onClick={() => handlePick(c.id)}
        />
      ))}
      <button
        type="button"
        className="hl-toolbar-close"
        title="Dismiss (Esc)"
        aria-label="Dismiss highlight toolbar"
        onClick={() => {
          clearDomSelection();
          hideSelection();
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
