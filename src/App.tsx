import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { ErrorBanner } from "@/components/common/ErrorBanner";
import { HomeScreen } from "@/components/library/HomeScreen";
import { RecentScreen } from "@/components/library/RecentScreen";
import { ComingSoon } from "@/components/library/ComingSoon";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { usePdfStore } from "@/state/pdfStore";

function LibraryScreen() {
  const sidebarView = usePdfStore((s) => s.sidebarView);

  switch (sidebarView) {
    case "recent":
      return <RecentScreen />;
    case "notes":
      return (
        <ComingSoon
          icon="note"
          title="Notes"
          description="All your PDF notes and highlights will live here, organized and searchable — stored locally on your device."
        />
      );
    case "bookmarks":
      return (
        <ComingSoon
          icon="bookmark"
          title="Bookmarks"
          description="Jump back to bookmarked pages across all your documents. Bookmarks arrive with the annotation batches."
        />
      );
    case "home":
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  const screen = usePdfStore((s) => s.screen);
  const refreshRecent = usePdfStore((s) => s.refreshRecent);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopToolbar />
        <ErrorBanner />
        <main className="content">
          {screen === "viewer" ? <PdfViewer /> : <LibraryScreen />}
        </main>
      </div>
    </div>
  );
}
