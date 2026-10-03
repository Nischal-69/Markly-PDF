import { memo } from "react";
import { useShallow } from "zustand/shallow";
import { useHighlightStore } from "@/state/highlightStore";

interface AnnotationLayerProps {
  pageNumber: number;
  /** Current zoom — quads are stored scale-free and projected here. */
  scale: number;
}

/**
 * Batch 3 layer: text highlights.
 *
 * Each quad is a translucent div positioned over the text layer. The PDF
 * text itself is never touched — selection, copying and rendering stay
 * exactly as PDF.js produced them.
 */
export const AnnotationLayer = memo(function AnnotationLayer({
  pageNumber,
  scale,
}: AnnotationLayerProps) {
  // Shallow comparison: this page re-renders only when its own
  // highlights actually change — never on unrelated pages or zoom
  // changes elsewhere. (Scale changes re-render by design: cheap divs.)
  const highlights = useHighlightStore(
    useShallow((s) => s.highlights.filter((h) => h.page === pageNumber)),
  );

  if (highlights.length === 0) return null;

  return (
    <>
      {highlights.map((h) =>
        h.quads.map((q, index) => (
          <div
            key={`${h.id}:${index}`}
            className={`hl hl-${h.color}`}
            data-highlight-id={h.id}
            style={{
              left: q.left * scale,
              top: q.top * scale,
              width: q.width * scale,
              height: q.height * scale,
            }}
          />
        )),
      )}
    </>
  );
});
