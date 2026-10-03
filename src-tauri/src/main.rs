use tauri_plugin_dialog;
use tauri_plugin_fs;

// Markly PDF — Tauri entry point.
// Native file access is done through the dialog + fs plugins so the app
// works fully offline with local files. Notes metadata lives in a local
// SQLite database (tauri-plugin-sql); PDFs themselves are never stored
// in SQLite — only note metadata + annotations.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:markly.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create notes table (metadata only)",
                        sql: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, doc_name TEXT NOT NULL, page INTEGER NOT NULL, kind TEXT NOT NULL, selected_text TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running Markly PDF");
}
