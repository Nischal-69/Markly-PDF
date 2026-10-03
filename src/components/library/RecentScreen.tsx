import { useState } from "react";
import { RecentList } from "./RecentList";
import { openPdfFromDisk, openRecentEntry } from "@/lib/files/fileHandling";
import type { RecentFile } from "@/lib/storage/recentFiles";
import { usePdfStore } from "@/state/pdfStore";

export function RecentScreen() {
  const recent = usePdfStore((s) => s.recent);
  const openPdf = usePdfStore((s) => s.openPdf);
  const removeRecent = usePdfStore((s) => s.removeRecent);
  const clearRecent = usePdfStore((s) => s.clearRecent);
  const [opening, setOpening] = useState(false);

  const handleOpenRecent = async (entry: RecentFile) => {
    if (opening) return;
    setOpening(true);
    try {
      const reopened = await openRecentEntry(entry);
      if (reopened) {
        await openPdf(reopened);
      } else {
        const picked = await openPdfFromDisk();
        if (picked) await openPdf(picked);
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="library-scroll">
      <section className="library-page">
        <RecentList
          entries={recent}
          onOpen={handleOpenRecent}
          onRemove={removeRecent}
          onClear={clearRecent}
        />
      </section>
    </div>
  );
}
