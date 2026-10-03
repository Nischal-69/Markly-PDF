import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { HIGHLIGHT_COLORS } from "@/lib/annotations/highlightTypes";
import { useHighlightStore } from "@/state/highlightStore";
import { useHighlightUi } from "@/state/highlightUi";

/**
 * Small popover for one existing highlight: recolor or delete.
 * Closes on outside click, scroll, zoom or document change.
 */
export function HighlightEditor() {
  const editor = useHighlightUi((s) => s.editor);
  const closeEditor = useHighlightUi((s) => s.closeEditor);
  const panelRef = useRef<HTMLDivElement>(null);

  const highlight = useHighlightStore((s) =>
    editor ? (s.highlights.find((h) => h.id === editor.highlightId) ?? null) : null,
  );
  const updateColor = useHighlightStore((s) => s.updateColor);
  const remove = useHighlightStore((s) => s.remove);

  // If the highlight vanished (deleted elsewhere), close up.
  useEffect(() => {
    if (editor && !highlight) closeEditor();
  }, [editor, highlight, closeEditor]);

  // Outside pointer-down closes; scroll/zoom/doc changes invalidate position.
  useEffect(() => {
    if (!editor) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeEditor();
      }
    };
    const onScroll = () => closeEditor();
    document.addEventListener("pointerdown", onPointerDown);
    const scrollEl = document.querySelector(".pdf-scroll");
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      scrollEl?.removeEventListener("scroll", onScroll);
    };
  }, [editor !== null, closeEditor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor || !highlight) return null;

  const x = Math.min(Math.max(editor.x, 130), window.innerWidth - 130);
  const y = Math.min(Math.max(editor.y, 12), window.innerHeight - 70);

  return (
    <div
      ref={panelRef}
      className="hl-editor"
      role="dialog"
      aria-label="Edit highlight"
      style={{ left: x, top: y }}
    >
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`hl-dot${highlight.color === c.id ? " is-active" : ""}`}
          style={{ backgroundColor: c.swatch }}
          title={`Change to ${c.label}`}
          aria-label={`Change highlight color to ${c.label}`}
          aria-pressed={highlight.color === c.id}
          onClick={() => updateColor(highlight.id, c.id)}
        />
      ))}
      <span className="hl-sep" />
      <button
        type="button"
        className="hl-delete"
        title="Delete highlight"
        aria-label="Delete highlight"
        onClick={() => {
          remove(highlight.id);
          closeEditor();
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}
