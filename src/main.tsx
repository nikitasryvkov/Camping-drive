import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import "./index.css";

const canonicalElement = document.getElementById("canonical-url");
const openGraphUrlElement = document.getElementById("og-url");
if (canonicalElement?.getAttribute("href") === "/") {
  const siteUrl = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
  const route = `${window.location.pathname}${window.location.search}`;
  const canonical = siteUrl ? `${siteUrl}${route}` : route;
  canonicalElement.setAttribute("href", canonical);
  openGraphUrlElement?.setAttribute("content", canonical);
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
