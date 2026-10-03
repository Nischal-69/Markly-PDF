import { makeRecentId } from "@/lib/storage/recentFiles";
import { usePdfStore } from "@/state/pdfStore";

/**
 * Stable per-document key for highlight persistence. Must be identical
 * everywhere highlights are loaded or saved for the open document.
 */
export function currentDocId(): string | null {
  const { fileName, filePath, fileSize } = usePdfStore.getState();
  if (!fileName) return null;
  return makeRecentId(filePath ?? "", fileName, fileSize ?? 0);
}
