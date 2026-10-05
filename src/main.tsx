import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initTheme } from "./state/themeStore";
import "./styles/globals.css";
import "./styles/sidebar.css";
import "./styles/toolbar.css";
import "./styles/viewer.css";
import "./styles/library.css";
import "./styles/highlights.css";
import "./styles/markups.css";
import "./styles/notes.css";
import "./styles/search.css";
import "./styles/bookmarks.css";
import "./styles/export.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Markly PDF: #root element is missing.");

// Apply the stored appearance before first paint (no light flash in
// dark mode) and follow OS theme changes while set to System.
initTheme();

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
