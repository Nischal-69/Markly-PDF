import { create } from "zustand";

/**
 * Batch 9 — appearance setting (Light / Dark / System).
 *
 * The setting persists in localStorage; the *effective* theme is applied
 * as `data-theme="light|dark"` on `<html>` so every stylesheet resolves
 * through CSS variables. "System" follows the OS `prefers-color-scheme`
 * media query live. PDF page paper itself always stays white — only the
 * surrounding chrome is themed.
 */

export type ThemeSetting = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "markly.theme.v1";

function readSetting(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Storage unavailable (private mode) — fall through to system.
  }
  return "system";
}

function systemIsDark(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  } catch {
    return false;
  }
}

export function resolveTheme(setting: ThemeSetting): EffectiveTheme {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  return systemIsDark() ? "dark" : "light";
}

/** Applies the effective theme to the document (idempotent). */
export function applyTheme(effective: EffectiveTheme): void {
  const root = document.documentElement;
  root.dataset.theme = effective;
  // Lets native controls (scrollbars, inputs, selects) match the theme.
  root.style.colorScheme = effective;
}

interface ThemeState {
  setting: ThemeSetting;
  effective: EffectiveTheme;
  setSetting: (setting: ThemeSetting) => void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  const setting = readSetting();
  const effective = resolveTheme(setting);
  return {
    setting,
    effective,
    setSetting: (next) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Non-fatal: the theme still applies for this session.
      }
      const resolved = resolveTheme(next);
      applyTheme(resolved);
      set({ setting: next, effective: resolved });
    },
  };
});

/**
 * Applies the stored theme before first paint (avoids a light flash when
 * the OS prefers dark) and keeps "system" in sync with OS changes.
 * Call once from `main.tsx`.
 */
export function initTheme(): void {
  const setting = readSetting();
  applyTheme(resolveTheme(setting));
  try {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = useThemeStore.getState().setting;
      if (current === "system") {
        const resolved = resolveTheme("system");
        applyTheme(resolved);
        useThemeStore.setState({ effective: resolved });
      }
    };
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
    } else if (typeof query.addListener === "function") {
      query.addListener(onChange);
    }
  } catch {
    // Media queries unavailable — the stored setting still applies.
  }
}
