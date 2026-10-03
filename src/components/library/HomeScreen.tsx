import { useState } from "react";
import { Logo } from "@/components/branding/Logo";
import { Icon } from "@/components/icons/Icon";
import { RecentList } from "./RecentList";
import { openPdfFromDisk, openRecentEntry } from "@/lib/files/fileHandling";
import type { RecentFile } from "@/lib/storage/recentFiles";
import { usePdfStore } from "@/state/pdfStore";

export function HomeScreen() {
  const recent = usePdfStore((s) => s.recent);
  const openPdf = usePdfStore((s) => s.openPdf);
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const picked = await openPdfFromDisk();
      if (picked) await openPdf(picked);
    } finally {
      setOpening(false);
    }
  };

  const handleOpenRecent = async (entry: RecentFile) => {
    // Tauri remembers the real path → silent reopen. Otherwise the user
    // picks the file again (browser cannot re-read disk silently).
    const reopened = await openRecentEntry(entry);
    if (reopened) {
      await openPdf(reopened);
    } else {
      await handleOpen();
    }
  };

  return (
    <div className="library-scroll">
      <section className="home-hero">
        <Logo size={44} withWordmark={false} />
        <h1>Markly PDF</h1>
        <p className="tagline">Read. Highlight. Note. Organize.</p>
        <p className="home-sub">
          Open a PDF from this computer to start reading. Your files stay on
          your device — Markly PDF works fully offline.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={handleOpen}
          disabled={opening}
        >
          <Icon name="open" size={16} />
          <span>{opening ? "Opening…" : "Open a PDF"}</span>
        </button>
      </section>

      <section className="home-recent">
        <RecentList
          entries={recent.slice(0, 8)}
          onOpen={handleOpenRecent}
          onRemove={usePdfStore((s) => s.removeRecent)}
          onClear={null}
          compact
        />
      </section>
    </div>
  );
}
