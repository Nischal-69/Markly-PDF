import { create } from "zustand";
import type { NoteKind } from "@/lib/notes/noteTypes";

export interface PendingNote {
  docId: string;
  docName: string;
  page: number;
  kind: NoteKind;
  selectedText: string;
  x: number;
  y: number;
}

interface NoteUiState {
  /** New-note draft (editor open in create mode). */
  pending: PendingNote | null;
  /** Existing note being edited (editor open in edit mode). */
  editingId: string | null;
  /** Note opened as a popup in the viewer (via indicator). */
  openNoteId: string | null;

  startNew: (pending: PendingNote) => void;
  startEdit: (id: string) => void;
  openNote: (id: string) => void;
  closeNote: () => void;
  closeEditor: () => void;
  closeAll: () => void;
}

export const useNoteUi = create<NoteUiState>()((set) => ({
  pending: null,
  editingId: null,
  openNoteId: null,

  startNew: (pending) =>
    set({ pending, editingId: null, openNoteId: null }),
  startEdit: (id) =>
    set({ editingId: id, pending: null, openNoteId: null }),
  openNote: (id) =>
    set({ openNoteId: id, pending: null, editingId: null }),
  closeNote: () => set({ openNoteId: null }),
  closeEditor: () => set({ pending: null, editingId: null }),
  closeAll: () => set({ pending: null, editingId: null, openNoteId: null }),
}));
