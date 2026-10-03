import { create } from "zustand";
import { getNoteDb } from "@/lib/notes/noteDb";
import type {
  NewNoteInput,
  NoteUpdate,
  PdfNote,
} from "@/lib/notes/noteTypes";

interface NoteState {
  all: PdfNote[];
  loaded: boolean;
  /** Note to scroll to / highlight (set by Notes panel navigation). */
  focusedNoteId: string | null;

  refresh: () => Promise<void>;
  createNote: (input: NewNoteInput) => Promise<PdfNote>;
  updateNote: (id: string, patch: NoteUpdate) => Promise<PdfNote | null>;
  deleteNote: (id: string) => Promise<void>;
  setFocusedNote: (id: string | null) => void;
  notesForDoc: (docId: string) => PdfNote[];
}

function sortNotes(list: PdfNote[]): PdfNote[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useNoteStore = create<NoteState>()((set, get) => ({
  all: [],
  loaded: false,
  focusedNoteId: null,

  refresh: async () => {
    const all = sortNotes(await getNoteDb().listAll());
    set({ all, loaded: true });
  },

  createNote: async (input) => {
    const created = await getNoteDb().insert(input);
    set((s) => ({ all: sortNotes([created, ...s.all]), loaded: true }));
    return created;
  },

  updateNote: async (id, patch) => {
    const updated = await getNoteDb().update(id, patch);
    if (!updated) return null;
    set((s) => ({
      all: sortNotes(s.all.map((n) => (n.id === id ? updated : n))),
    }));
    return updated;
  },

  deleteNote: async (id) => {
    await getNoteDb().remove(id);
    set((s) => ({
      all: s.all.filter((n) => n.id !== id),
      focusedNoteId: s.focusedNoteId === id ? null : s.focusedNoteId,
    }));
  },

  setFocusedNote: (id) => set({ focusedNoteId: id }),

  notesForDoc: (docId) => get().all.filter((n) => n.docId === docId),
}));
