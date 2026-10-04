import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { openPdfFromDisk, openRecentEntry } from "@/lib/files/fileHandling";
import { makeRecentId } from "@/lib/storage/recentFiles";
import { useBookmarkStore } from "@/state/bookmarkStore";
import { usePdfStore } from "@/state/pdfStore";

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}

/**
 * Batch 7 bookmarks panel: every page bookmark with editable label,
 * document name + page, and one-click jump. Stored locally only.
 */
export function BookmarksPanel() {
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const loaded = useBookmarkStore((s) => s.loaded);
  const load = useBookmarkStore((s) => s.load);
  const rename = useBookmarkStore((s) => s.rename);
  const remove = useBookmarkStore((s) => s.remove);
  const addBookmark = useBookmarkStore((s) => s.addBookmark);

  const openPdf = usePdfStore((s) => s.openPdf);
  const notify = usePdfStore((s) => s.notify);

  const [query, setQuery] = useState("");
  const [docFilter, setDocFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const docs = useMemo(() => {
    const map = new Map<string, { docId: string; docName: string; count: number }>();
    for (const b of bookmarks) {
      const entry = map.get(b.docId);
      if (entry) entry.count += 1;
      else map.set(b.docId, { docId: b.docId, docName: b.docName, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.docName.localeCompare(b.docName));
  }, [bookmarks]);

  const activeDocFilter = docs.some((d) => d.docId === docFilter) ? docFilter : "all";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = bookmarks;
    if (activeDocFilter !== "all") list = list.filter((b) => b.docId === activeDocFilter);
    if (q) {
      list = list.filter((b) =>
        `${b.title} ${b.docName} page ${b.page}`.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bookmarks, query, activeDocFilter]);

  const handleOpen = async (bookmarkId: string) => {
    const mark = useBookmarkStore.getState().bookmarks.find((b) => b.id === bookmarkId);
    if (!mark || openingId) return;
    setOpeningId(bookmarkId);
    try {
      const pdf = usePdfStore.getState();
      const currentId = pdf.fileName
        ? makeRecentId(pdf.filePath ?? "", pdf.fileName, pdf.fileSize ?? 0)
        : null;
      if (currentId && currentId === mark.docId && pdf.docKey) {
        pdf.showViewer();
        pdf.goToPage(mark.page);
      } else {
        const recent = pdf.recent.find((r) => r.id === mark.docId);
        let opened = recent ? await openRecentEntry(recent) : null;
        if (!opened && recent?.path) {
          opened = await openRecentEntry({ path: recent.path, name: recent.name });
        }
        if (opened) {
          await openPdf(opened);
          usePdfStore.getState().goToPage(mark.page);
        } else {
          notify(`Please open ${mark.docName} to view this bookmark.`);
          const picked = await openPdfFromDisk();
          if (picked) {
            await openPdf(picked);
            const after = usePdfStore.getState();
            const afterId = after.fileName
              ? makeRecentId(after.filePath ?? "", after.fileName, after.fileSize ?? 0)
              : null;
            if (afterId === mark.docId) usePdfStore.getState().goToPage(mark.page);
          } else {
            return;
          }
        }
      }
    } finally {
      setOpeningId(null);
    }
  };

  const commitRename = (id: string) => {
    const mark = bookmarks.find((b) => b.id === id);
    if (!mark) {
      setEditingId(null);
      return;
    }
    rename(id, draft);
    setEditingId(null);
  };

  const bookmarkCurrentPage = () => {
    const pdf = usePdfStore.getState();
    if (!pdf.fileName || pdf.numPages < 1) {
      notify("Open a PDF first, then bookmark the current page.");
      return;
    }
    const docId = makeRecentId(pdf.filePath ?? "", pdf.fileName, pdf.fileSize ?? 0);
    addBookmark(docId, pdf.fileName, pdf.currentPage);
    notify(`Bookmarked page ${pdf.currentPage}.`);
  };

  if (!loaded) {
    return (
      <div className="library-scroll">
        <section className="library-page">
          <div className="recent-empty">
            <span className="spinner" aria-hidden="true" />
            <p>Loading bookmarks…</p>
          </div>
        </section>
      </div>
    );
  }

  const isFiltering = query.trim() !== "" || activeDocFilter !== "all";

  return (
    <div className="library-scroll">
      <section className="library-page bookmarks-page">
        <div className="bookmarks-head">
          <h2>
            Bookmarks{" "}
            {bookmarks.length > 0 && <span className="muted">({bookmarks.length})</span>}
          </h2>
          <div className="bookmarks-head-actions">
            <input
              type="search"
              className="bookmarks-search"
              placeholder="Search bookmarks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search bookmarks"
            />
            <button
              type="button"
              className="btn btn-small"
              onClick={bookmarkCurrentPage}
              title="Bookmark the current page (Ctrl+D)"
            >
              <Icon name="bookmark" size={13} />
              <span>Bookmark this page</span>
            </button>
          </div>
        </div>

        {bookmarks.length > 0 && (
          <div className="bookmarks-filters">
            <label className="bookmarks-filter">
              <span className="bookmarks-filter-label">PDF</span>
              <select
                className="bookmarks-select"
                value={activeDocFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                aria-label="Filter bookmarks by PDF"
              >
                <option value="all">All PDFs ({bookmarks.length})</option>
                {docs.map((d) => (
                  <option key={d.docId} value={d.docId}>
                    {d.docName} ({d.count})
                  </option>
                ))}
              </select>
            </label>
            {isFiltering && (
              <span className="bookmarks-count muted" role="status">
                Showing {filtered.length} of {bookmarks.length}
              </span>
            )}
          </div>
        )}

        {bookmarks.length === 0 ? (
          <div className="recent-empty">
            <Icon name="bookmark" size={28} />
            <p>No bookmarks yet.</p>
            <p className="muted">
              Open a PDF and press <kbd>Ctrl+D</kbd> — or click “Bookmark this
              page” — to jump back here instantly.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="recent-empty">
            <p>
              {query.trim()
                ? `No bookmarks match “${query.trim()}”.`
                : "No bookmarks in this PDF yet."}
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
          <ul className="bookmarks-list">
            {filtered.map((b) => (
              <li key={b.id} className="bookmark-row">
                <button
                  type="button"
                  className="bookmark-main"
                  onClick={() => handleOpen(b.id)}
                  title={`Open ${b.docName}, page ${b.page}`}
                >
                  <span className="bookmark-icon" aria-hidden="true">
                    <Icon name="bookmark" size={14} />
                  </span>
                  <span className="bookmark-text">
                    {editingId === b.id ? (
                      <span
                        role="presentation"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <input
                          className="bookmark-rename"
                          value={draft}
                          autoFocus
                          maxLength={200}
                          aria-label="Bookmark name"
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitRename(b.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(b.id);
                            else if (e.key === "Escape") setEditingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </span>
                    ) : (
                      <span className="bookmark-title">{b.title}</span>
                    )}
                    <span className="bookmark-meta">
                      <Icon name="file" size={12} />
                      <span className="bookmark-doc" title={b.docName}>
                        {b.docName}
                      </span>
                      <span>· Page {b.page}</span>
                      <span>· {formatDate(b.updatedAt)}</span>
                    </span>
                  </span>
                </button>
                <span className="bookmark-side">
                  <button
                    type="button"
                    className="btn btn-icon btn-quiet"
                    onClick={() => {
                      setEditingId(b.id);
                      setDraft(b.title);
                    }}
                    title="Rename bookmark"
                    aria-label={`Rename bookmark ${b.title}`}
                  >
                    <Icon name="pen" size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-quiet"
                    onClick={() => remove(b.id)}
                    title="Delete bookmark"
                    aria-label={`Delete bookmark ${b.title}`}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
                {openingId === b.id && (
                  <span className="bookmark-opening" role="status">
                    Opening…
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="bookmarks-hint muted">
          Shortcuts: <kbd>Ctrl+F</kbd> search · <kbd>Enter</kbd> next result ·{" "}
          <kbd>Shift+Enter</kbd> previous · <kbd>Ctrl+D</kbd> bookmark page ·{" "}
          <kbd>Esc</kbd> close.
        </p>
      </section>
    </div>
  );
}
