/**
 * Clean SQLite database layer for PDF notes.
 *
 * - Persistent local storage via SQLite under Tauri
 *   (`tauri-plugin-sql`, file `sqlite:markly.db`, table `notes`).
 * - Browser / web fallback via localStorage with the identical async
 *   interface, so `npm run dev` and Playwright keep working.
 * - Stores metadata + annotations ONLY. PDF bytes are never stored here.
 *
 * Table (also created by the Rust migration in `src-tauri/src/main.rs`;
 * the `CREATE TABLE IF NOT EXISTS` below keeps web + dev in sync):
 *
 *   notes(id TEXT PRIMARY KEY, doc_id TEXT, doc_name TEXT, page INTEGER,
 *         kind TEXT, selected_text TEXT, title TEXT, content TEXT,
 *         x REAL, y REAL, created_at INTEGER, updated_at INTEGER)
 */

import {
  createNoteId,
  isNoteKind,
  sanitizePage,
  type NewNoteInput,
  type NoteUpdate,
  type PdfNote,
} from "./noteTypes";

const LOCAL_KEY = "markly.notes.v1";
const SQLITE_PATH = "sqlite:markly.db";

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  page INTEGER NOT NULL,
  kind TEXT NOT NULL,
  selected_text TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`;

interface NoteRow {
  id: unknown;
  doc_id: unknown;
  doc_name: unknown;
  page: unknown;
  kind: unknown;
  selected_text: unknown;
  title: unknown;
  content: unknown;
  x: unknown;
  y: unknown;
  created_at: unknown;
  updated_at: unknown;
}

type SqliteDb = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  select: <T>(sql: string, params?: unknown[]) => Promise<T>;
};

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !==
      undefined ||
      (window as unknown as Record<string, unknown>).__TAURI__ !== undefined)
  );
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function rowToNote(row: NoteRow): PdfNote | null {
  if (typeof row.id !== "string" || typeof row.doc_id !== "string") return null;
  if (!isNoteKind(row.kind)) return null;
  return {
    id: row.id,
    docId: row.doc_id,
    docName: str(row.doc_name, "Document"),
    page: sanitizePage(row.page, 1),
    kind: row.kind,
    selectedText: str(row.selected_text),
    title: str(row.title),
    content: str(row.content),
    x: num(row.x, 0),
    y: num(row.y, 0),
    createdAt: num(row.created_at, 0),
    updatedAt: num(row.updated_at, 0),
  };
}

function noteToParams(n: PdfNote): unknown[] {
  return [
    n.id,
    n.docId,
    n.docName,
    n.page,
    n.kind,
    n.selectedText,
    n.title,
    n.content,
    n.x,
    n.y,
    n.createdAt,
    n.updatedAt,
  ];
}

// --- localStorage fallback (web / tests) -----------------------------------

function readLocal(): PdfNote[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PdfNote[] = [];
    for (const item of parsed) {
      const note = rowFromJson(item);
      if (note) out.push(note);
    }
    return out;
  } catch {
    return [];
  }
}

function writeLocal(notes: PdfNote[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(notes));
  } catch {
    // Storage full / private mode: non-fatal.
  }
}

function rowFromJson(raw: unknown): PdfNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return rowToNote({
    id: r.id,
    doc_id: r.docId,
    doc_name: r.docName,
    page: r.page,
    kind: r.kind,
    selected_text: r.selectedText,
    title: r.title,
    content: r.content,
    x: r.x,
    y: r.y,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  });
}

// --- database ---------------------------------------------------------------

export type NoteDriver = "sqlite" | "localStorage";

export class NoteDatabase {
  private sqlite: SqliteDb | null = null;
  private driver: NoteDriver = "localStorage";
  private initPromise: Promise<void> | null = null;

  /** Active backend ("sqlite" under Tauri, "localStorage" on web). */
  get backend(): NoteDriver {
    return this.driver;
  }

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.connect().catch(() => {
        this.sqlite = null;
        this.driver = "localStorage";
      });
    }
    return this.initPromise;
  }

  private async connect(): Promise<void> {
    if (!isTauri()) {
      this.driver = "localStorage";
      return;
    }
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = mod.default;
    const db = (await Database.load(SQLITE_PATH)) as SqliteDb;
    await db.execute(CREATE_TABLE_SQL);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_notes_doc ON notes(doc_id)",
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)",
    );
    this.sqlite = db;
    this.driver = "sqlite";
  }

  async listAll(): Promise<PdfNote[]> {
    await this.init();
    if (this.sqlite) {
      const rows = await this.sqlite.select<NoteRow[]>(
        "SELECT id, doc_id, doc_name, page, kind, selected_text, title, content, x, y, created_at, updated_at FROM notes ORDER BY updated_at DESC",
      );
      const out: PdfNote[] = [];
      for (const row of rows ?? []) {
        const note = rowToNote(row);
        if (note) out.push(note);
      }
      return out;
    }
    return readLocal().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listForDoc(docId: string): Promise<PdfNote[]> {
    await this.init();
    if (this.sqlite) {
      const rows = await this.sqlite.select<NoteRow[]>(
        "SELECT id, doc_id, doc_name, page, kind, selected_text, title, content, x, y, created_at, updated_at FROM notes WHERE doc_id = ? ORDER BY page ASC, updated_at DESC",
        [docId],
      );
      const out: PdfNote[] = [];
      for (const row of rows ?? []) {
        const note = rowToNote(row);
        if (note) out.push(note);
      }
      return out;
    }
    return readLocal()
      .filter((n) => n.docId === docId)
      .sort((a, b) => a.page - b.page || b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<PdfNote | null> {
    await this.init();
    if (this.sqlite) {
      const rows = await this.sqlite.select<NoteRow[]>(
        "SELECT id, doc_id, doc_name, page, kind, selected_text, title, content, x, y, created_at, updated_at FROM notes WHERE id = ? LIMIT 1",
        [id],
      );
      const first = (rows ?? [])[0];
      return first ? rowToNote(first) : null;
    }
    return readLocal().find((n) => n.id === id) ?? null;
  }

  async insert(input: NewNoteInput): Promise<PdfNote> {
    await this.init();
    const now = Date.now();
    const note: PdfNote = {
      id: createNoteId(),
      docId: input.docId,
      docName: input.docName || "Document",
      page: sanitizePage(input.page, 1),
      kind: input.kind,
      selectedText: (input.selectedText ?? "").slice(0, 2000),
      title: input.title.trim().slice(0, 200) || "Untitled note",
      content: input.content.slice(0, 20000),
      x: num(input.x, 0),
      y: num(input.y, 0),
      createdAt: now,
      updatedAt: now,
    };
    if (this.sqlite) {
      await this.sqlite.execute(
        "INSERT INTO notes (id, doc_id, doc_name, page, kind, selected_text, title, content, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        noteToParams(note),
      );
      return note;
    }
    const all = readLocal();
    all.push(note);
    writeLocal(all);
    return note;
  }

  async update(id: string, patch: NoteUpdate): Promise<PdfNote | null> {
    await this.init();
    const current = await this.get(id);
    if (!current) return null;
    const next: PdfNote = {
      ...current,
      title:
        patch.title !== undefined
          ? patch.title.trim().slice(0, 200) || "Untitled note"
          : current.title,
      content:
        patch.content !== undefined
          ? patch.content.slice(0, 20000)
          : current.content,
      page: patch.page !== undefined ? sanitizePage(patch.page, current.page) : current.page,
      x: patch.x !== undefined ? num(patch.x, current.x) : current.x,
      y: patch.y !== undefined ? num(patch.y, current.y) : current.y,
      selectedText:
        patch.selectedText !== undefined
          ? patch.selectedText.slice(0, 2000)
          : current.selectedText,
      updatedAt: Date.now(),
    };
    if (this.sqlite) {
      await this.sqlite.execute(
        "UPDATE notes SET doc_name = ?, page = ?, selected_text = ?, title = ?, content = ?, x = ?, y = ?, updated_at = ? WHERE id = ?",
        [
          next.docName,
          next.page,
          next.selectedText,
          next.title,
          next.content,
          next.x,
          next.y,
          next.updatedAt,
          id,
        ],
      );
      return next;
    }
    writeLocal(readLocal().map((n) => (n.id === id ? next : n)));
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.init();
    if (this.sqlite) {
      await this.sqlite.execute("DELETE FROM notes WHERE id = ?", [id]);
      return;
    }
    writeLocal(readLocal().filter((n) => n.id !== id));
  }

  /** Test seam: wipes the fallback store (never touches SQLite). */
  clearLocalCache(): void {
    try {
      window.localStorage.removeItem(LOCAL_KEY);
    } catch {
      // Non-fatal.
    }
  }
}

let singleton: NoteDatabase | null = null;

export function getNoteDb(): NoteDatabase {
  if (!singleton) singleton = new NoteDatabase();
  return singleton;
}
