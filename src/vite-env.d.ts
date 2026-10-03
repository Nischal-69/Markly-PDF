/// <reference types="vite/client" />

interface TauriWindow {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}

declare global {
  interface Window extends TauriWindow {}
}

export {};
