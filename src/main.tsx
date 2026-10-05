import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
