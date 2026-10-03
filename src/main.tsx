import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/sidebar.css";
import "./styles/toolbar.css";
import "./styles/viewer.css";
import "./styles/library.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Markly PDF: #root element is missing.");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
