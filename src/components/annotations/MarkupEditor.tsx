import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { currentDocId } from "@/lib/annotations/docId";
import {
  MARKUP_COLORS,
  MARKUP_STROKES,
  MAX_TEXT_LENGTH,
} from "@/lib/annotations/markupTypes";
import { useMarkupStore } from "@/state/markupStore";
import { useMarkupUi } from "@/state/markupUi";

/**
 * Editor popover for one selected markup: recolor, line thickness,
 * text editing (text markups) and delete. Closes on outside click,
 * scroll, zoom or document change — same pattern as HighlightEditor.
 */
export function MarkupEditor() {
  const selectedId = useMarkupUi((s) => s.selectedId);
  const editorAnchor = useMarkupUi((s) => s.editorAnchor);
  const closeEditor = useMarkupUi((s) => s.closeEditor);

  const markup = useMarkupStore((s) =>
    selectedId ? (s.markups.find((m) => m.id === selectedId) ?? null) : null,
  );
  const updateStyle = useMarkupStore((s) => s.updateStyle);
  const updateText = useMarkupStore((s) => s.updateText);
  const remove = useMarkupStore((s) => s.remove);

  const [text, setText] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (markup && markup.kind === "text") setText(markup.text);
  }, [markup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the markup vanished (deleted elsewhere), close up.
  useEffect(() => {
    if (selectedId && !markup) closeEditor();
  }, [selectedId, markup, closeEditor]);

  // Outside pointer-down closes; scroll/zoom/doc changes invalidate position.
  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Shape clicks stop propagation, but svg hit strokes on some
        // browsers still bubble — ignore clicks on other markups so the
        // editor doesn't flicker when switching selection.
        const hit = (e.target as HTMLElement | null)?.closest?.("[data-markup-id]");
        if (!hit) closeEditor();
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
  }, [selectedId !== null, closeEditor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedId || !markup || !editorAnchor) return null;

  const x = Math.min(Math.max(editorAnchor.x, 170), window.innerWidth - 170);
  const y = Math.min(Math.max(editorAnchor.y, 12), window.innerHeight - 90);
  const needsStroke = markup.kind !== "text";
  const kindLabel =
    markup.kind === "strike" ? "Strikethrough"
    : markup.kind === "ellipse" ? "Circle"
    : markup.kind === "freehand" ? "Freehand drawing"
    : markup.kind === "rect" ? "Rectangle"
    : markup.kind === "underline" ? "Underline"
    : markup.kind === "arrow" ? "Arrow"
    : "Text annotation";

  return (
    <div
      ref={panelRef}
      className="mk-editor"
      role="dialog"
      aria-label={`Edit ${kindLabel.toLowerCase()}`}
      style={{ left: x, top: y }}
    >
      {markup.kind === "text" && (
        <div className="mk-editor-text">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TEXT_LENGTH}
            aria-label="Text annotation content"
          />
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={() => {
              if (text.trim()) {
                updateText(markup.id, text);
                closeEditor();
              }
            }}
            disabled={!text.trim()}
          >
            Save
          </button>
        </div>
      )}
      {MARKUP_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`markup-dot${markup.color === c.swatch ? " is-active" : ""}`}
          style={{ backgroundColor: c.swatch }}
          title={`Change to ${c.label}`}
          aria-label={`Change annotation color to ${c.label}`}
          aria-pressed={markup.color === c.swatch}
          onClick={() => updateStyle(markup.id, { color: c.swatch })}
        />
      ))}
      {needsStroke && (
        <>
          <span className="hl-sep" aria-hidden="true" />
          {MARKUP_STROKES.map((w) => (
            <button
              key={w}
              type="button"
              className="btn btn-small"
              title={`Line thickness ${w === 1.5 ? "thin" : w === 2.5 ? "medium" : "thick"}`}
              aria-label={`Set line thickness ${w === 1.5 ? "thin" : w === 2.5 ? "medium" : "thick"}`}
              aria-pressed={markup.stroke === w}
              style={markup.stroke === w ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
              onClick={() => updateStyle(markup.id, { stroke: w })}
            >
              {w === 1.5 ? "Thin" : w === 2.5 ? "Med" : "Thick"}
            </button>
          ))}
        </>
      )}
      <span className="hl-sep" aria-hidden="true" />
      <button
        type="button"
        className="hl-delete"
        title={`Delete ${kindLabel.toLowerCase()}`}
        aria-label={`Delete ${kindLabel.toLowerCase()}`}
        onClick={() => {
          remove(markup.id);
          closeEditor();
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}

/**
 * Placement dialog for the text tool: the user clicked a page position,
 * then types the annotation text. Saves through the markup store (same
 * local persistence as every other markup).
 */
export function MarkupTextDialog() {
  const textDraft = useMarkupUi((s) => s.textDraft);
  const closeTextDraft = useMarkupUi((s) => s.closeTextDraft);
  const addShape = useMarkupStore((s) => s.addShape);
  const color = useMarkupUi((s) => s.color);

  const [value, setValue] = useState("");

  useEffect(() => {
    if (textDraft) setValue("");
  }, [textDraft]);

  useEffect(() => {
    if (!textDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTextDraft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [textDraft, closeTextDraft]);

  if (!textDraft) return null;

  const handleSave = () => {
    const docId = currentDocId();
    if (!docId || !value.trim()) return;
    addShape(
      docId,
      {
        kind: "text",
        page: textDraft.page,
        x: textDraft.x,
        y: textDraft.y,
        text: value,
      },
      { color },
    );
    closeTextDraft();
  };

  return (
    <div
      className="mk-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeTextDraft();
      }}
    >
      <div className="mk-dialog" role="dialog" aria-modal="true" aria-label="Add text annotation">
        <h2>Add text annotation · Page {textDraft.page}</h2>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type your annotation…"
          rows={4}
          maxLength={MAX_TEXT_LENGTH}
          autoFocus
          aria-label="Text annotation content"
        />
        <div className="mk-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={closeTextDraft}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!value.trim()}
          >
            Save annotation
          </button>
        </div>
      </div>
    </div>
  );
}
