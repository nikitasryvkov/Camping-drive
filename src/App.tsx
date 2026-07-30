import { AdminApp } from "./admin/AdminApp";
import { NotFoundPage } from "./public/NotFoundPage";
import { PublicPage } from "./public/PublicPage";
import { PublicNewsArticlePage, PublicNewsListPage } from "./public/PublicNews";
import { SiteSettingsProvider } from "./SiteSettingsContext";

export default function App() {
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
    return <AdminApp />;
  }

  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/news") return <SiteSettingsProvider><PublicNewsListPage /></SiteSettingsProvider>;
  const newsMatch = /^\/news\/([^/]+)$/.exec(path);
  if (newsMatch) {
    let slug: string;
    try {
      slug = decodeURIComponent(newsMatch[1]!);
    } catch {
      return <SiteSettingsProvider><NotFoundPage /></SiteSettingsProvider>;
    }
    return <SiteSettingsProvider><PublicNewsArticlePage slug={slug} /></SiteSettingsProvider>;
  }

  return <SiteSettingsProvider><PublicPage /></SiteSettingsProvider>;
}
