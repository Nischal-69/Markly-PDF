import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useNoteStore } from "@/state/noteStore";
import { useNoteUi } from "@/state/noteUi";

/**
 * Create / edit dialog for PDF notes.
 * Saves locally through the note store (SQLite under Tauri,
 * localStorage fallback on web). Covers create, edit, view + close;
 * delete lives in the viewer popup and the Notes panel.
 */
export function NoteEditor() {
  const pending = useNoteUi((s) => s.pending);
  const editingId = useNoteUi((s) => s.editingId);
  const closeEditor = useNoteUi((s) => s.closeEditor);
  const openNote = useNoteUi((s) => s.openNote);

  const editingNote = useNoteStore((s) =>
    editingId ? (s.all.find((n) => n.id === editingId) ?? null) : null,
  );
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = pending !== null || editingNote !== null;
  const mode = pending ? "create" : "edit";

  // Prefill when the dialog opens (new draft or existing note).
  useEffect(() => {
    if (pending) {
      setTitle("");
      setContent("");
      setError(null);
    } else if (editingNote) {
      setTitle(editingNote.title);
      setContent(editingNote.content);
      setError(null);
    }
  }, [pending, editingNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeEditor]);

  if (!isOpen) return null;

  const contextLabel = pending
    ? pending.kind === "selection"
      ? `Page ${pending.page} · Selected text`
      : `Page ${pending.page} · Page note`
    : editingNote
      ? `Page ${editingNote.page} · ${editingNote.kind === "selection" ? "Selection note" : "Page note"}`
      : "";

  const quoted = pending
    ? pending.selectedText
    : (editingNote?.selectedText ?? "");

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (pending) {
        const created = await createNote({
          docId: pending.docId,
          docName: pending.docName,
          page: pending.page,
          kind: pending.kind,
          selectedText: pending.selectedText,
          title: title.trim() || "Untitled note",
          content,
          x: pending.x,
          y: pending.y,
        });
        closeEditor();
        // Return to the viewer popup so the new note is immediately visible.
        openNote(created.id);
      } else if (editingNote) {
        await updateNote(editingNote.id, { title, content });
        const id = editingNote.id;
        closeEditor();
        // Back to view mode after edit (covers create, edit, view, close).
        openNote(id);
      } else {
        closeEditor();
      }
    } catch {
      setError("Could not save the note. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="note-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeEditor();
      }}
    >
      <div
        className="note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "Add note" : "Edit note"}
      >
        <div className="note-dialog-head">
          <h2>{mode === "create" ? "Add note" : "Edit note"}</h2>
          <button
            type="button"
            className="btn btn-icon btn-quiet"
            onClick={closeEditor}
            title="Close (Esc)"
            aria-label="Close note editor"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="note-dialog-context">{contextLabel}</div>

        {quoted.trim() && (
          <blockquote className="note-quote" title="Selected text">
            {quoted.trim().slice(0, 300)}
          </blockquote>
        )}

        <label className="note-field">
          <span>Note title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Key argument to revisit"
            maxLength={200}
            autoFocus
            aria-label="Note title"
          />
        </label>

        <label className="note-field">
          <span>Note content</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your note here…"
            rows={5}
            maxLength={20000}
            aria-label="Note content"
          />
        </label>

        {error && (
          <div className="note-error" role="alert">
            {error}
          </div>
        )}

        <div className="note-dialog-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={closeEditor}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : mode === "create" ? "Save note" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
