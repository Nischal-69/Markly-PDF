import { memo, useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { Icon } from "@/components/icons/Icon";
import { useNoteStore } from "@/state/noteStore";
import { useNoteUi } from "@/state/noteUi";

interface NoteLayerProps {
  pageNumber: number;
  /** Current zoom — positions are stored scale-free and projected here. */
  scale: number;
}

/**
 * Annotation-system layer for notes (independent from PDF rendering).
 *
 * The PDF viewer owns pixels; this layer owns note indicators. Each note
 * renders a small button offset beside its anchor so PDF text is never
 * covered. Clicking the indicator opens the note popup.
 */
export const NoteLayer = memo(function NoteLayer({
  pageNumber,
  scale,
}: NoteLayerProps) {
  const notes = useNoteStore(
    useShallow((s) => s.all.filter((n) => n.page === pageNumber)),
  );
  const openNote = useNoteUi((s) => s.openNote);
  const openNoteId = useNoteUi((s) => s.openNoteId);
  const focusedNoteId = useNoteStore((s) => s.focusedNoteId);

  // Deep-link from the Notes panel: bring the focused pin into view.
  useEffect(() => {
    if (!focusedNoteId) return;
    if (!notes.some((n) => n.id === focusedNoteId)) return;
    const el = document.querySelector(`.note-pin[data-note-id="${focusedNoteId}"]`);
    el?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [focusedNoteId, notes]);

  if (notes.length === 0) return null;

  return (
    <>
      {notes.map((note) => {
        const isPageCorner =
          note.kind === "page" && note.x === 0 && note.y === 0;
        const style: React.CSSProperties = isPageCorner
          ? { right: 10, top: 10 }
          : {
              left: note.x * scale + 6,
              top: Math.max(note.y * scale - 12, 2),
            };
        const isOpen = openNoteId === note.id;
        const isFocused = focusedNoteId === note.id;
        return (
          <button
            key={note.id}
            type="button"
            className={`note-pin${isOpen ? " is-open" : ""}${isFocused ? " is-focused" : ""}`}
            style={style}
            data-note-id={note.id}
            title={note.title || "Open note"}
            aria-label={`Open note: ${note.title || "Untitled note"}`}
            aria-expanded={isOpen}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openNote(note.id);
            }}
          >
            <Icon name="note" size={12} />
            {note.kind === "page" && <span className="note-pin-page">P</span>}
          </button>
        );
      })}
    </>
  );
});

/**
 * Floating viewer popup for one open note: view, edit, delete, close.
 * Positioned fixed (bottom-right of viewport) so it never covers PDF text.
 */
export function NotePopup() {
  const openNoteId = useNoteUi((s) => s.openNoteId);
  const closeNote = useNoteUi((s) => s.closeNote);
  const startEdit = useNoteUi((s) => s.startEdit);
  const closeAll = useNoteUi((s) => s.closeAll);
  const panelRef = useRef<HTMLDivElement>(null);

  const note = useNoteStore((s) =>
    openNoteId ? (s.all.find((n) => n.id === openNoteId) ?? null) : null,
  );
  const deleteNote = useNoteStore((s) => s.deleteNote);

  useEffect(() => {
    if (openNoteId && !note) closeNote();
  }, [openNoteId, note, closeNote]);

  // Outside click / Esc closes. Scroll does NOT close (unlike highlight
  // editor) so users can read long notes while scrolling the PDF.
  useEffect(() => {
    if (!openNoteId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const pin = (e.target as HTMLElement | null)?.closest?.(".note-pin");
        if (!pin) closeNote();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openNoteId, closeNote, closeAll]);

  if (!openNoteId || !note) return null;

  const when = new Date(note.updatedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      ref={panelRef}
      className="note-popup"
      role="dialog"
      aria-label={`Note: ${note.title}`}
    >
      <div className="note-popup-head">
        <div className="note-popup-meta">
          <span className="note-kind">
            {note.kind === "selection" ? "Selection note" : "Page note"}
          </span>
          <span className="note-page">Page {note.page}</span>
        </div>
        <button
          type="button"
          className="btn btn-icon btn-quiet"
          onClick={closeNote}
          title="Close note (Esc)"
          aria-label="Close note"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <h3 className="note-popup-title">{note.title || "Untitled note"}</h3>

      {note.selectedText.trim() && (
        <blockquote className="note-quote small">
          {note.selectedText.trim().slice(0, 240)}
        </blockquote>
      )}

      <p className="note-popup-content">
        {note.content.trim() || <span className="muted">No content.</span>}
      </p>

      <div className="note-popup-foot">
        <span className="muted small">{when}</span>
        <span className="note-popup-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => startEdit(note.id)}
            aria-label="Edit note"
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            onClick={() => {
              void deleteNote(note.id).then(() => closeNote());
            }}
            aria-label="Delete note"
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      </div>
    </div>
  );
}
