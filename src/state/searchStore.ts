import { create } from "zustand";
import {
  searchPagesIncremental,
  setSearchDocKey,
} from "@/lib/search/searchEngine";
import { usePdfStore } from "@/state/pdfStore";

export type SearchStatus = "idle" | "searching" | "done";

export interface ActiveSearchLocation {
  page: number;
  indexInPage: number;
}

interface SearchState {
  /** Document the current search belongs to (null = none). */
  docKey: string | null;
  numPages: number;
  isOpen: boolean;
  /** Raw input value (updates on every keystroke). */
  query: string;
  /** Debounced, actually-searched query. */
  activeQuery: string;
  status: SearchStatus;
  /** Per-page match counts, index 0 = page 1. */
  counts: number[];
  total: number;
  searchedPages: number;
  /** Global 0-based match index; -1 when none / no selection yet. */
  activeIndex: number;
  /** Bumps for every completed or cancelled run (stale-run guard). */
  runId: number;

  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  resetForDoc: (docKey: string | null, numPages: number) => void;
  next: () => void;
  prev: () => void;
  /** Global index → page + index-within-page. */
  activeLocation: () => ActiveSearchLocation | null;
}

function locate(counts: number[], index: number): ActiveSearchLocation | null {
  if (index < 0) return null;
  let rest = index;
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i];
    if (rest < c) return { page: i + 1, indexInPage: rest };
    rest -= c;
  }
  return null;
}

function jumpTo(loc: ActiveSearchLocation | null): void {
  if (!loc) return;
  usePdfStore.getState().goToPage(loc.page);
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  docKey: null,
  numPages: 0,
  isOpen: false,
  query: "",
  activeQuery: "",
  status: "idle",
  counts: [],
  total: 0,
  searchedPages: 0,
  activeIndex: -1,
  runId: 0,

  open: () => set({ isOpen: true }),
  // Closing keeps a running search alive in the background so reopening
  // shows completed results instead of a stuck "searching" state.
  close: () => set({ isOpen: false }),

  setQuery: (query: string) => {
    const { docKey, numPages, runId } = get();
    set({ query });
    const trimmed = query.trim();
    // Empty → clear immediately and cancel any run.
    if (!trimmed) {
      set((s) => ({
        activeQuery: "",
        status: "idle",
        counts: s.numPages > 0 ? new Array(s.numPages).fill(0) : [],
        total: 0,
        searchedPages: 0,
        activeIndex: -1,
        runId: s.runId + 1,
      }));
      return;
    }
    if (!docKey || numPages < 1) return;
    const myRun = runId + 1;
    set({
      runId: myRun,
      status: "searching",
      activeQuery: trimmed,
      counts: new Array(numPages).fill(0),
      total: 0,
      searchedPages: 0,
      activeIndex: -1,
    });
    const needle = trimmed;
    void (async () => {
      const counts = new Array<number>(numPages).fill(0);
      let total = 0;
      let firstHitPage: number | null = null;
      await searchPagesIncremental(
        needle,
        numPages,
        (result, done) => {
          const s = get();
          if (s.runId !== myRun) return;
          counts[result.page - 1] = result.count;
          total += result.count;
          if (result.count > 0 && firstHitPage === null) {
            firstHitPage = result.page;
          }
          set({
            counts: [...counts],
            total,
            searchedPages: done,
          });
        },
        () => get().runId !== myRun,
      );
      const s = get();
      if (s.runId !== myRun) return;
      const finalTotal = counts.reduce((a, b) => a + b, 0);
      // Auto-select the first match so Enter/prev-next works instantly
      // and the user gets immediate visual feedback.
      const activeIndex = finalTotal > 0 ? 0 : -1;
      set({ status: "done", counts: [...counts], total: finalTotal, searchedPages: numPages, activeIndex });
      if (activeIndex === 0) jumpTo(locate(counts, 0));
    })();
  },

  resetForDoc: (docKey: string | null, numPages: number) => {
    setSearchDocKey(docKey);
    set((s) => ({
      docKey,
      numPages,
      query: "",
      activeQuery: "",
      status: "idle",
      counts: numPages > 0 ? new Array(numPages).fill(0) : [],
      total: 0,
      searchedPages: 0,
      activeIndex: -1,
      runId: s.runId + 1,
      // Keep the bar's open state across documents: the user explicitly
      // opened/closed it. Counts are cleared above either way.
    }));
  },

  next: () => {
    const { total, activeIndex } = get();
    if (total < 1) return;
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % total;
    set({ activeIndex: nextIndex });
    jumpTo(locate(get().counts, nextIndex));
  },

  prev: () => {
    const { total, activeIndex } = get();
    if (total < 1) return;
    const prevIndex =
      activeIndex < 0 ? total - 1 : (activeIndex - 1 + total) % total;
    set({ activeIndex: prevIndex });
    jumpTo(locate(get().counts, prevIndex));
  },

  activeLocation: () => locate(get().counts, get().activeIndex),
}));
