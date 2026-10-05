import { memo, useEffect, useState } from "react";
import { useSearchStore } from "@/state/searchStore";

interface SearchHitBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SearchLayerProps {
  pageNumber: number;
  /** Current zoom — boxes are re-measured on change. */
  scale: number;
  docKey: string;
}

/** Max highlight boxes per page (keeps pathological queries cheap). */
const MAX_HITS_PER_PAGE = 400;

/**
 * Batch 7 per-page search highlight layer.
 *
 * Measures match boxes from the LIVE text layer (Range.getClientRects),
 * so search highlighting is pixel-exact at any zoom and never interferes
 * with highlight/note/markup storage or rendering. Only within-span
 * matches are highlighted (cross-span hyphenation is rare; the result
 * count from the engine still includes those pages so nothing is lost).
 */
export const SearchLayer = memo(function SearchLayer({
  pageNumber,
  scale,
  docKey,
}: SearchLayerProps) {
  const activeQuery = useSearchStore((s) => s.activeQuery);
  const activeIndex = useSearchStore((s) => s.activeIndex);
  // Subscribe to THIS page's count only: progress updates for other pages
  // must not re-render every layer (large PDFs: N pages × N updates).
  // The prefix sum below stays correct because search runs sequentially
  // (pages before this one are final by the time this count settles) and
  // the active index is only set once the run completes.
  const ownCount = useSearchStore((s) => s.counts[pageNumber - 1] ?? 0);

  const [hits, setHits] = useState<SearchHitBox[]>([]);

  const needle = activeQuery.trim().toLowerCase();

  // Active match index within THIS page (-1 when another page is active).
  // ownCount is subscribed above (re-render trigger); the prefix sum is
  // read fresh from the store so other pages' updates don't re-render us.
  let activeInPage = -1;
  if (needle && activeIndex >= 0 && ownCount > 0) {
    const all = useSearchStore.getState().counts;
    let rest = activeIndex;
    for (let i = 0; i < all.length; i += 1) {
      const c = all[i] ?? 0;
      if (i + 1 === pageNumber) {
        activeInPage = rest >= 0 && rest < c ? rest : -1;
        break;
      }
      rest -= c;
      if (rest < 0) break;
    }
  }

  useEffect(() => {
    // No query → no boxes, no observers, zero per-page cost. This keeps
    // the layer free for large PDFs until search is actually used.
    if (!needle) {
      setHits([]);
      return undefined;
    }
    let disposed = false;
    let raf = 0;
    let observer: MutationObserver | null = null;

    const scan = () => {
      if (disposed) return;
      const pageEl = document.querySelector(
        `.pdf-page[data-page-number="${pageNumber}"]`,
      ) as HTMLElement | null;
      const textLayer = pageEl?.querySelector(
        ":scope .pdf-text-layer",
      ) as HTMLElement | null;
      if (!pageEl || !textLayer) {
        setHits([]);
        return;
      }
      const spans = textLayer.querySelectorAll("span[data-div-index]");
      if (spans.length === 0) {
        setHits([]);
        return;
      }
      const pageRect = pageEl.getBoundingClientRect();
      const out: SearchHitBox[] = [];
      outer: for (const span of Array.from(spans)) {
        const el = span as HTMLElement;
        const text = el.textContent ?? "";
        if (!text) continue;
        const lower = text.toLowerCase();
        let from = 0;
        for (;;) {
          const idx = lower.indexOf(needle, from);
          if (idx === -1) break;
          const node = el.firstChild;
          if (node && node.nodeType === Node.TEXT_NODE) {
            try {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, Math.min(text.length, idx + needle.length));
              const rects = range.getClientRects();
              for (const r of Array.from(rects)) {
                if (r.width < 1 || r.height < 1) continue;
                out.push({
                  left: r.left - pageRect.left,
                  top: r.top - pageRect.top,
                  width: r.width,
                  height: r.height,
                });
                if (out.length >= MAX_HITS_PER_PAGE) break outer;
              }
            } catch {
              // Detached node mid-render — skip this occurrence.
            }
          }
          from = idx + Math.max(1, needle.length);
        }
      }
      setHits(out);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    };

    schedule();

    // The text layer is built asynchronously after canvas render; observe
    // it so highlights appear as soon as the page paints (and on zoom).
    const pageEl = document.querySelector(
      `.pdf-page[data-page-number="${pageNumber}"]`,
    );
    const textLayer = pageEl?.querySelector(":scope .pdf-text-layer");
    if (textLayer) {
      observer = new MutationObserver(schedule);
      observer.observe(textLayer, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
    // Re-scan when the query, zoom, or document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, scale, pageNumber, docKey]);

  // Keep the active match in view (page-level scroll is handled by the
  // viewer's navToken; this centers the exact hit without fighting it).
  useEffect(() => {
    if (activeInPage < 0) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-search-hit="${pageNumber}:${activeInPage}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", inline: "nearest" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [activeInPage, pageNumber, hits.length]);

  if (!needle || hits.length === 0) return null;

  return (
    <>
      {hits.map((h, i) => (
        <div
          key={i}
          data-search-hit={`${pageNumber}:${i}`}
          data-search-active={i === activeInPage ? "true" : undefined}
          className={
            i === activeInPage ? "search-hit is-active" : "search-hit"
          }
          style={{
            left: h.left,
            top: h.top,
            width: h.width,
            height: h.height,
          }}
        />
      ))}
    </>
  );
});
