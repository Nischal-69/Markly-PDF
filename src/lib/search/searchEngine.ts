import { getPage } from "@/lib/pdf/pdfEngine";

/**
 * Batch 7 search engine: plain-text extraction + literal matching.
 *
 * Positioning is deliberately NOT done here. This module only answers
 * "which pages contain the query, and how many times" — fast, cancellable
 * and safe for large PDFs. Highlight boxes are measured from the live
 * text layer by `SearchLayer`, so search never touches highlight/note/
 * markup geometry and stays correct across zoom without extra math.
 */

interface CachedPageText {
  text: string;
  lower: string;
}

let cachedDocKey: string | null = null;
const textCache = new Map<number, CachedPageText>();

/** Switches the cache to a new document (drops stale page texts). */
export function setSearchDocKey(docKey: string | null): void {
  if (cachedDocKey !== docKey) {
    cachedDocKey = docKey;
    textCache.clear();
  }
}

export function clearSearchCache(): void {
  cachedDocKey = null;
  textCache.clear();
}

/** Raw (non-lowercased) page text, joined from PDF.js text items. */
async function fetchPageText(pageNumber: number): Promise<CachedPageText> {
  const hit = textCache.get(pageNumber);
  if (hit) return hit;
  const page = await getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if (typeof item === "object" && item !== null && "str" in item) {
        const str = (item as { str?: unknown }).str;
        if (typeof str === "string" && str) parts.push(str);
      }
    }
    // Items are fragments of lines; a space join keeps word boundaries
    // for counting while staying cheap. Intra-span matching in the
    // highlight layer covers the same matches visually.
    const text = parts.join(" ");
    const entry = { text, lower: text.toLowerCase() };
    textCache.set(pageNumber, entry);
    return entry;
  } finally {
    try {
      page.cleanup();
    } catch {
      // Best effort.
    }
  }
}

/** Counts non-overlapping literal occurrences (case-insensitive). */
export function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + needleLower.length;
    // Guard absurd single-char queries on huge pages (cap: still "fast").
    if (count > 5000) return count;
  }
}

export interface PageSearchResult {
  page: number;
  count: number;
}

/**
 * Incrementally searches pages [1..numPages] for a literal query.
 * Calls `onPage` as each page finishes so the UI streams progress;
 * `isCancelled` is polled between chunks to abort stale runs.
 * Yields to the event loop every few pages to keep scrolling smooth.
 */
export async function searchPagesIncremental(
  query: string,
  numPages: number,
  onPage: (result: PageSearchResult, done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const needle = query.toLowerCase();
  for (let page = 1; page <= numPages; page += 1) {
    if (isCancelled()) return;
    let count = 0;
    try {
      const entry = await fetchPageText(page);
      count = countOccurrences(entry.lower, needle);
    } catch {
      count = 0;
    }
    if (isCancelled()) return;
    onPage({ page, count }, page, numPages);
    // Let paint/input happen; chunked so large PDFs stay interactive.
    if (page % 4 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}
