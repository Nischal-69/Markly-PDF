import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { useSearchStore } from "@/state/searchStore";

/**
 * Batch 7 floating search bar: query input, live result count,
 * previous/next navigation and progress while large PDFs stream in.
 * Rendered inside the viewer so it floats over the page list.
 */
export function SearchBar() {
  const isOpen = useSearchStore((s) => s.isOpen);
  const query = useSearchStore((s) => s.query);
  const activeQuery = useSearchStore((s) => s.activeQuery);
  const status = useSearchStore((s) => s.status);
  const total = useSearchStore((s) => s.total);
  const activeIndex = useSearchStore((s) => s.activeIndex);
  const searchedPages = useSearchStore((s) => s.searchedPages);
  const numPages = useSearchStore((s) => s.numPages);

  const setQuery = useSearchStore((s) => s.setQuery);
  const close = useSearchStore((s) => s.close);
  const next = useSearchStore((s) => s.next);
  const prev = useSearchStore((s) => s.prev);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  // Focus the input whenever the bar opens.
  useEffect(() => {
    if (isOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isOpen]);

  // Cancel pending debounce on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  if (!isOpen) return null;

  const searching = status === "searching";
  const hasQuery = activeQuery.trim() !== "";

  let countLabel: string;
  if (!hasQuery) {
    countLabel = "Type to search";
  } else if (searching) {
    countLabel =
      total > 0
        ? `${total} found · ${searchedPages}/${numPages} pages…`
        : `Searching… ${searchedPages}/${numPages} pages`;
  } else if (total === 0) {
    countLabel = "No results";
  } else {
    countLabel = `${activeIndex + 1} of ${total}`;
  }

  const handleChange = (value: string) => {
    // Update the box instantly; debounce the expensive document scan so
    // fast typing on large PDFs stays smooth.
    useSearchStore.setState({ query: value });
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setQuery(value);
      return;
    }
    debounceRef.current = window.setTimeout(() => setQuery(value), 250);
  };

  return (
    <div
      className="search-bar"
      role="search"
      aria-label="Search in PDF"
      onMouseDown={(e) => {
        // Clicking nav buttons must not steal viewer text selection focus
        // handling; keep it simple: don't propagate to page mouse handlers.
        e.stopPropagation();
      }}
    >
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder="Search in PDF…"
        aria-label="Search in PDF"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) prev();
            else next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "F3") {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) prev();
            else next();
          }
        }}
      />
      <span className="search-count" role="status" aria-live="polite">
        {countLabel}
      </span>
      <button
        type="button"
        className="btn btn-icon btn-quiet search-nav"
        onClick={prev}
        disabled={total < 1}
        title="Previous result (Shift+Enter)"
        aria-label="Previous result"
      >
        <Icon name="chevronLeft" size={15} />
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet search-nav"
        onClick={next}
        disabled={total < 1}
        title="Next result (Enter)"
        aria-label="Next result"
      >
        <Icon name="chevronRight" size={15} />
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet search-nav"
        onClick={close}
        title="Close search (Esc)"
        aria-label="Close search"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
