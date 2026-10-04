import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { openPdfFromDisk, openRecentEntry } from "@/lib/files/fileHandling";
import { notePreview } from "@/lib/notes/noteTypes";
import { makeRecentId } from "@/lib/storage/recentFiles";
import { useNoteStore } from "@/state/noteStore";
import { useNoteUi } from "@/state/noteUi";
import { usePdfStore } from "@/state/pdfStore";

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}

function formatFull(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type SortOrder = "newest" | "oldest";

/**
 * Notes navigation panel: every note with title, PDF name, page,
 * short preview + modified date. Clicking a note opens its PDF,
 * navigates to the page and focuses the note.
 */
export function NotesPanel() {
  const all = useNoteStore((s) => s.all);
  const loaded = useNoteStore((s) => s.loaded);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const setFocusedNote = useNoteStore((s) => s.setFocusedNote);
  const openNote = useNoteUi((s) => s.openNote);
  const startEdit = useNoteUi((s) => s.startEdit);

  const openPdf = usePdfStore((s) => s.openPdf);
  const notify = usePdfStore((s) => s.notify);

  const [query, setQuery] = useState("");
  const [docFilter, setDocFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [openingId, setOpeningId] = useState<string | null>(null);

  /** Distinct PDFs that have notes, for the "Filter by PDF" dropdown. */
  const docs = useMemo(() => {
    const map = new Map<string, { docId: string; docName: string; count: number }>();
    for (const n of all) {
      const entry = map.get(n.docId);
      if (entry) {
        entry.count += 1;
      } else {
        map.set(n.docId, { docId: n.docId, docName: n.docName, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.docName.localeCompare(b.docName),
    );
  }, [all]);

  // If the filtered doc disappears (all its notes deleted), reset to "all".
  const activeDocFilter = docs.some((d) => d.docId === docFilter) ? docFilter : "all";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = all;
    if (activeDocFilter !== "all") {
      list = list.filter((n) => n.docId === activeDocFilter);
    }
    if (q) {
      list = list.filter((n) =>
        `${n.title} ${n.content} ${n.selectedText} ${n.docName}`
          .toLowerCase()
          .includes(q),
      );
    }
    const sorted = [...list].sort((a, b) =>
      sortOrder === "newest" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt,
    );
    return sorted;
  }, [all, query, activeDocFilter, sortOrder]);

  const handleOpen = async (noteId: string) => {
    const note = useNoteStore.getState().all.find((n) => n.id === noteId);
    if (!note || openingId) return;
    setOpeningId(noteId);
    try {
      const pdf = usePdfStore.getState();
      const { fileName, filePath, fileSize } = pdf;
      const currentId = fileName
        ? makeRecentId(filePath ?? "", fileName, fileSize ?? 0)
        : null;

      // Same document still in memory (viewer or library) → show it,
      // navigate to the page, focus the note.
      if (currentId && currentId === note.docId && pdf.docKey) {
        usePdfStore.getState().showViewer();
        usePdfStore.getState().goToPage(note.page);
      } else {
        // Try silent reopen (works under Tauri when the path is known).
        const recent = pdf.recent.find((r) => r.id === note.docId);
        let opened = recent ? await openRecentEntry(recent) : null;
        if (!opened && recent && recent.path) {
          opened = await openRecentEntry({ path: recent.path, name: recent.name });
        }
        if (opened) {
          await openPdf(opened);
          usePdfStore.getState().goToPage(note.page);
        } else {
          // Browser (no path) or moved file: ask the user to locate it.
          notify(`Please open ${note.docName} to view this note.`);
          const picked = await openPdfFromDisk();
          if (picked) {
            await openPdf(picked);
            // If it's the same logical doc, jump to the note's page.
            const after = usePdfStore.getState();
            const afterId = after.fileName
              ? makeRecentId(after.filePath ?? "", after.fileName, after.fileSize ?? 0)
              : null;
            if (afterId === note.docId) {
              usePdfStore.getState().goToPage(note.page);
            }
          } else {
            return;
          }
        }
      }

      setFocusedNote(note.id);
      openNote(note.id);
    } finally {
      setOpeningId(null);
    }
  };

  if (!loaded) {
    return (
      <div className="library-scroll">
        <section className="library-page">
          <div className="recent-empty">
            <span className="spinner" aria-hidden="true" />
            <p>Loading notes…</p>
          </div>
        </section>
      </div>
    );
  }

  const isFiltering = query.trim() !== "" || activeDocFilter !== "all";

  return (
    <div className="library-scroll">
      <section className="library-page notes-page">
        <div className="notes-head">
          <h2>Notes {all.length > 0 && <span className="muted">({all.length})</span>}</h2>
          <input
            type="search"
            className="notes-search"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search notes"
          />
        </div>

        {all.length > 0 && (
          <div className="notes-filters">
            <label className="notes-filter">
              <span className="notes-filter-label">PDF</span>
              <select
                className="notes-select"
                value={activeDocFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                aria-label="Filter notes by PDF"
              >
                <option value="all">All PDFs ({all.length})</option>
                {docs.map((d) => (
                  <option key={d.docId} value={d.docId}>
                    {d.docName} ({d.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="notes-filter">
              <span className="notes-filter-label">Sort</span>
              <select
                className="notes-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                aria-label="Sort notes"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            {isFiltering && (
              <span className="notes-count muted" role="status">
                Showing {filtered.length} of {all.length}
              </span>
            )}
          </div>
        )}

        {all.length === 0 ? (
          <div className="recent-empty">
            <Icon name="note" size={28} />
            <p>No notes yet.</p>
            <p className="muted">
              Select text in a PDF and choose “Add Note”, or add a page note
              from the toolbar.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="recent-empty">
            <p>
              {query.trim()
                ? `No notes match “${query.trim()}”.`
                : "No notes in this PDF yet."}
            </p>
            {isFiltering && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setQuery("");
                  setDocFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <ul className="notes-list">
            {filtered.map((note) => {
              const edited = Math.abs(note.updatedAt - note.createdAt) > 60_000;
              const dateLabel = edited
                ? `Edited ${formatDate(note.updatedAt)} · Created ${formatDate(note.createdAt)}`
                : `Created ${formatDate(note.createdAt)}`;
              const dateTitle = `Created: ${formatFull(note.createdAt)} · Modified: ${formatFull(note.updatedAt)}`;
              return (
              <li key={note.id} className="note-row">
                <button
                  type="button"
                  className="note-main"
                  onClick={() => handleOpen(note.id)}
                  title={`Open ${note.docName}, page ${note.page}`}
                >
                  <span className="note-row-title">{note.title || "Untitled note"}</span>
                  <span className="note-row-meta">
                    <Icon name="file" size={12} />
                    <span className="note-row-doc" title={note.docName}>
                      {note.docName}
                    </span>
                    <span>· Page {note.page}</span>
                  </span>
                  <span className="note-row-preview">{notePreview(note)}</span>
                  <span className="note-row-dates" title={dateTitle}>
                    {dateLabel}
                  </span>
                </button>
                <span className="note-row-side">
                  <button
                    type="button"
                    className="btn btn-icon btn-quiet"
                    onClick={() => startEdit(note.id)}
                    title="Edit note"
                    aria-label={`Edit note ${note.title}`}
                  >
                    <Icon name="note" size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-quiet"
                    onClick={() => {
                      void deleteNote(note.id);
                    }}
                    title="Delete note"
                    aria-label={`Delete note ${note.title}`}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
                {openingId === note.id && (
                  <span className="note-row-opening" role="status">
                    Opening…
                  </span>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
