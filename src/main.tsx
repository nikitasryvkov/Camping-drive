import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

const siteUrl = import.meta.env.VITE_SITE_URL?.trim();
if (siteUrl) {
  document.getElementById("canonical-url")?.setAttribute("href", siteUrl);
  const ogUrl = document.createElement("meta");
  ogUrl.setAttribute("property", "og:url");
  ogUrl.content = siteUrl;
  document.head.append(ogUrl);
}
initAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
