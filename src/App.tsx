import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { ErrorBanner } from "@/components/common/ErrorBanner";
import { Toast } from "@/components/common/Toast";
import { HighlightEditor } from "@/components/annotations/HighlightEditor";
import { MarkupEditor, MarkupTextDialog } from "@/components/annotations/MarkupEditor";
import { MarkupToolbar } from "@/components/annotations/MarkupToolbar";
import { SelectionToolbar } from "@/components/annotations/SelectionToolbar";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NotePopup } from "@/components/notes/NoteLayer";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { HomeScreen } from "@/components/library/HomeScreen";
import { RecentScreen } from "@/components/library/RecentScreen";
import { ComingSoon } from "@/components/library/ComingSoon";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { usePdfStore } from "@/state/pdfStore";
import { useNoteStore } from "@/state/noteStore";

function LibraryScreen() {
  const sidebarView = usePdfStore((s) => s.sidebarView);

  switch (sidebarView) {
    case "recent":
      return <RecentScreen />;
    case "notes":
      return <NotesPanel />;
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
  const refreshNotes = useNoteStore((s) => s.refresh);

  useEffect(() => {
    refreshRecent();
    void refreshNotes();
  }, [refreshRecent, refreshNotes]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopToolbar />
        <MarkupToolbar />
        <ErrorBanner />
        <main className="content">
          {screen === "viewer" ? <PdfViewer /> : <LibraryScreen />}
        </main>
        <SelectionToolbar />
        <HighlightEditor />
        <MarkupEditor />
        <MarkupTextDialog />
        <NoteEditor />
        <NotePopup />
        <Toast />
      </div>
    </div>
  );
}
