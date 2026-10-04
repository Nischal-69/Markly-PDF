import { create } from "zustand";
import {
  cleanBookmarkTitle,
  createBookmarkId,
  loadBookmarks,
  persistBookmarks,
  type Bookmark,
} from "@/lib/bookmarks/bookmarkRepo";
import { currentDocId } from "@/lib/annotations/docId";
import { usePdfStore } from "@/state/pdfStore";

interface BookmarkState {
  bookmarks: Bookmark[];
  loaded: boolean;

  load: () => void;
  /** Bookmarks for one document, ordered by page then creation. */
  forDoc: (docId: string) => Bookmark[];
  isBookmarked: (docId: string, page: number) => boolean;
  addBookmark: (docId: string, docName: string, page: number, title?: string) => Bookmark | null;
  toggleCurrentPage: () => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
}

function order(list: Bookmark[]): Bookmark[] {
  return [...list].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt,
  );
}

export const useBookmarkStore = create<BookmarkState>()((set, get) => ({
  bookmarks: [],
  loaded: false,

  load: () => {
    set({ bookmarks: order(loadBookmarks()), loaded: true });
  },

  forDoc: (docId: string) =>
    get()
      .bookmarks.filter((b) => b.docId === docId)
      .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),

  isBookmarked: (docId: string, page: number) =>
    get().bookmarks.some((b) => b.docId === docId && b.page === page),

  addBookmark: (docId, docName, page, title) => {
    if (!docId || page < 1) return null;
    const now = Date.now();
    const cleanPage = Math.floor(page);
    const created: Bookmark = {
      id: createBookmarkId(),
      docId,
      docName: docName || "Document",
      page: cleanPage,
      title: cleanBookmarkTitle(title ?? "", cleanPage),
      createdAt: now,
      updatedAt: now,
    };
    const next = order([...get().bookmarks, created]);
    set({ bookmarks: next, loaded: true });
    persistBookmarks(next);
    return created;
  },

  toggleCurrentPage: () => {
    const pdf = usePdfStore.getState();
    const docId = currentDocId();
    if (!docId || !pdf.fileName || pdf.numPages < 1) return;
    const page = Math.min(pdf.numPages, Math.max(1, Math.floor(pdf.currentPage)));
    const { bookmarks } = get();
    const existing = bookmarks.filter((b) => b.docId === docId && b.page === page);
    if (existing.length > 0) {
      const ids = new Set(existing.map((b) => b.id));
      const next = bookmarks.filter((b) => !ids.has(b.id));
      set({ bookmarks: next });
      persistBookmarks(next);
    } else {
      get().addBookmark(docId, pdf.fileName, page);
    }
  },

  rename: (id, title) => {
    const { bookmarks } = get();
    const target = bookmarks.find((b) => b.id === id);
    if (!target) return;
    const next = bookmarks.map((b) =>
      b.id === id
        ? { ...b, title: cleanBookmarkTitle(title, b.page), updatedAt: Date.now() }
        : b,
    );
    set({ bookmarks: order(next) });
    persistBookmarks(get().bookmarks);
  },

  remove: (id: string) => {
    const next = get().bookmarks.filter((b) => b.id !== id);
    set({ bookmarks: next });
    persistBookmarks(next);
  },
}));
