# Markly PDF — Microsoft Store release guide (Batch 11)

## 1. Release configuration (done)

| Item | Value | Where |
|---|---|---|
| Application name | Markly PDF | `productName`, window title |
| Version | 0.1.0 (synced in `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json`) | all three files |
| Application identity | `com.markly.pdf` | `identifier` in `tauri.conf.json` |
| Publisher | `Markly` (placeholder — must match Partner Center, see §5) | `bundle.publisher` |
| Copyright | `Copyright © 2026 Markly. All rights reserved.` | `bundle.copyright` |
| Category | Productivity | `bundle.category` |
| App icon | Full generated set (`icon.ico`, PNGs, `icon.icns`, MSIX tiles) | `src-tauri/icons/`, wired in `bundle.icon` |
| Installer targets | NSIS (per-user) + MSI (per-machine capable) | `bundle.targets` |
| NSIS | `currentUser` (no admin), English, no language selector | `bundle.windows.nsis` |
| WiX/MSI | Stable `upgradeCode` so updates replace instead of duplicating | `bundle.windows.wix` |
| Permissions | Least privilege: `core:default`, `dialog:default`, `fs:default` + `fs:read-files` + `fs:write-files`, `sql:*` for notes | `src-tauri/capabilities/default.json` |
| Release scripts | `npm run tauri:build`, `npm run release:windows` | `package.json` |

### Why the fs capability change matters
`fs:default` alone allows reads only inside app folders and no writes at all.
Markly reads/writes *dialog-chosen* files; the dialog plugin adds exactly those
paths to the fs scope at runtime, but the `read_file`/`stat`/`write_file`
commands themselves were denied — so **Save/Export silently fell back to a
browser download in the desktop app**. `fs:read-files` + `fs:write-files`
fix native Save/Export while keeping scope tight (app dirs + user-picked paths
only). Browser (Playwright) builds are unaffected — they never call the plugins.

### Deliberately NOT done
- **No `.pdf` file association declared.** The app has no launch-with-file-argument
  handling (no single-instance/argv plumbing), so registering one would open the
  app *without* the double-clicked file — worse than no association. Add
  `tauri-plugin-single-instance` + argv handling first (tracked follow-up).
- **No MSIX target in this repo.** `tauri-cli@2.12.1` only bundles `msi`/`nsis`
  (see `tauri build --help`). Store route is §4 below.
- Nothing was submitted anywhere. No signing credentials are stored in the repo.

## 2. How to build the release

Prerequisites (one time, on the release machine):
1. **Visual Studio 2022 Build Tools** (or full VS) with the
   **“Desktop development with C++”** workload — provides `link.exe`.
   https://aka.ms/vs/17/release/vs_BuildTools.exe
2. **Rust stable MSVC toolchain**: `rustup default stable-x86_64-pc-windows-msvc`
   (already the default here; verified with `npx tauri info`).
3. **NSIS 3.x** on `PATH` (`makensis`) — only needed for the `nsis` bundle.
   WiX is provisioned automatically by the Tauri bundler.
4. Node 24 + npm (this repo).

Build:
```powershell
npm run release:windows
# equivalent: npm run build && npx tauri build --bundles nsis msi --ci
```

Outputs land in `src-tauri/target/release/bundle/`:
- `nsis/Markly PDF_0.1.0_x64-setup.exe` — per-user installer (no admin).
- `msi/Markly PDF_0.1.0_x64_en-US.msi` — enterprise/per-machine capable.

> This machine (Lenovo, non-admin, no VS Build Tools) cannot link the Rust
> binary — `tauri build` fails at `link.exe not found`. Everything up to the
> native link was validated here; run the command above on a provisioned
> machine or CI (`windows-latest` runners already include MSVC + NSIS needs
> `nsis` installed via `choco install nsis`).

## 3. Verification performed here

- `npm run check` (tsc) — clean.
- `npx tauri info` — config loads with no validation errors; all Tauri
  packages version-matched (2.12.1); WebView2 154 detected.
- Production frontend (`vite build` output, byte-identical to what ships
  inside the installer) — full Playwright suite: **34/38 pass**. The 4
  failures are pre-existing environment flakiness, proven by rebuilding the
  pristine baseline via `git stash` and re-running: identical failures
  (fit-page 0.8px rounding; synthetic mouse-drag precision in
  highlights/markups specs). The markups spec passes 4/4 in isolation.
- Install/launch/data smoke of the native package is **pending the provisioned
  build** (see §2). Checklist for that run:
  1. Install NSIS setup per-user → files under `%LOCALAPPDATA%`.
  2. Launch → home screen renders, no crash (check version + icon in Taskbar).
  3. Open a PDF (dialog → native `readFile` now permitted), zoom/scroll.
  4. Create note + highlight + annotation → close + reopen → persisted
     (`%APPDATA%/com.markly.pdf/markly.db` grows; `localStorage` intact).
  5. Export annotated PDF → native save dialog writes the file.
  6. Uninstall → app removed, data dir left intact (standard).

## 4. Getting into the Microsoft Store

Pick one:
- **A. MSIX (recommended):** run the NSIS-installed app through Microsoft's
  **MSIX Packaging Tool**, sign with your Partner Center certificate, upload
  the `.msix` to Partner Center. Tile assets are already generated
  (`src-tauri/icons/Square*Logo.png`, `StoreLogo.png`).
- **B. Unpackaged Win32:** Partner Center accepts classic installers — submit
  the NSIS `.exe` directly as an unpackaged app.

In both cases the Store identity (Package Identity Name + Publisher `CN=…`)
comes from **your Partner Center account** and must replace the placeholders
(`com.markly.pdf` / `Markly`) at packaging time — see §5.

## 5. Information still needed from you (nothing works without these)

1. **Partner Center Package Identity Name** (e.g. `12345YourName.MarklyPDF…`)
   → replaces `identifier` for the Store package.
2. **Publisher certificate subject** (`CN=…`, from your Store certificate) →
   replaces `bundle.publisher` (must match *exactly* or install fails).
3. **Legal publisher name + support contact/privacy-policy URL** for the
   Store listing (also decides the final `copyright` string).
4. **App category/age rating submission answers** (Productivity is set;
   questionnaire + rating are done in Partner Center, not in code).
5. **Signing:** Store upload needs no local cert (Partner Center signs), but
   any `.msix` you distribute yourself must be signed (self-signed test cert
   or Azure Trusted Signing) and the cert trusted on test machines.
6. Optional: confirm display name stays **“Markly PDF”** and language stays
   English-only for v1.
