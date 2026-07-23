import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { FloatingActions } from "../components/FloatingActions";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { buttonStyles } from "../components/ui/Button";
import { useSiteSettings } from "../SiteSettingsContext";
import type { PublicSiteSettings } from "../siteSettings";
import { PublicBlockRenderer } from "./PublicBlockRenderer";
import { getPublicPage, PublicApiError, type PublicPage as PublicPageData, type PublicPageBlock } from "./api";
import { NotFoundPage } from "./NotFoundPage";

type PageState =
  | { status: "loading" }
  | { status: "loaded"; page: PublicPageData }
  | { status: "not-found" }
  | { status: "error" };

const headingBlockTypes = new Set(["hero", "text", "image-text", "cards", "features", "steps", "stats", "gallery", "reviews", "faq", "route-map", "cta", "latest-news"]);

export function PublicPage() {
  const settings = useSiteSettings();
  const slug = useMemo(() => slugFromPath(window.location.pathname), []);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<PageState>(slug ? { status: "loading" } : { status: "not-found" });

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    getPublicPage(slug, controller.signal)
      .then((page) => setState({ status: "loaded", page }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(error instanceof PublicApiError && error.status === 404 ? { status: "not-found" } : { status: "error" });
      });
    return () => controller.abort();
  }, [reloadKey, slug]);

  useEffect(() => {
    if (state.status === "loaded") {
      updatePageMetadata(state.page, settings);
      const anchor = window.location.hash.slice(1);
      if (anchor) {
        const scrollToAnchor = () => document.getElementById(anchor)?.scrollIntoView();
        window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToAnchor));
        const timer = window.setTimeout(scrollToAnchor, 150);
        return () => window.clearTimeout(timer);
      }
    } else if (state.status === "not-found") {
      document.title = `Страница не найдена — ${settings.siteName}`;
      setMetaDescription("Запрошенная страница не найдена или ещё не опубликована.");
      setRobots("noindex, nofollow");
      const siteUrl = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
      const canonical = siteUrl ? `${siteUrl}${window.location.pathname}` : window.location.pathname;
      document.getElementById("canonical-url")?.setAttribute("href", canonical);
      setPropertyMeta("og:title", `Страница не найдена — ${settings.siteName}`);
      setPropertyMeta("og:description", "Запрошенная страница не найдена или ещё не опубликована.");
      setPropertyMeta("og:url", canonical);
    }
  }, [settings, state]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);

  if (state.status === "not-found") return <NotFoundPage />;
  if (state.status === "loading") return <PageLoading />;
  if (state.status === "error") return <PageError onRetry={retry} />;

  const blocks = [...state.page.blocks].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const overlayNavigation = blocks[0]?.type === "hero";
  const pageHeadingIndex = blocks.findIndex((block) => headingBlockTypes.has(block.type));

  return (
    <>
      <Navbar overlayAtTop={overlayNavigation} />
      <main className={overlayNavigation ? "" : "pt-20"}>
        {pageHeadingIndex === -1 && blocks.length > 0 ? <h1 className="sr-only">{state.page.title}</h1> : null}
        {blocks.length > 0 ? blocks.map((block, index) => (
          <PublicBlockRenderer key={block.id} block={block} sectionId={sectionId(block)} isPageHeading={index === pageHeadingIndex} />
        )) : <EmptyPublishedPage title={state.page.title} />}
      </main>
      <Footer />
      <FloatingActions />
    </>
  );
}

function slugFromPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "home";
  if (normalized.includes("/")) return null;
  return normalized;
}

function sectionId(block: PublicPageBlock): string {
  const anchor = block.content.anchor;
  return typeof anchor === "string" && /^[a-z][a-z0-9-]{0,99}$/.test(anchor)
    ? anchor
    : `block-${block.id}`;
}

function PageLoading() {
  const settings = useSiteSettings();
  return (
    <main className="grid min-h-dvh place-items-center bg-background" aria-live="polite" aria-busy="true">
      <div className="text-center">
        <img src={settings.logoUrl} alt={settings.logoAlt} className="mx-auto h-16 w-auto rounded-2xl bg-white p-2 shadow-soft" />
        <div className="mx-auto mt-7 h-1.5 w-36 overflow-hidden rounded-full bg-border"><span className="block h-full w-1/2 animate-pulse rounded-full bg-accent" /></div>
        <p className="mt-4 text-sm text-muted">Загружаем страницу…</p>
      </div>
    </main>
  );
}

function PageError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 text-center">
      <div className="max-w-lg">
        <p className="eyebrow">Связь прервалась</p>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl">Страница временно недоступна</h1>
        <p className="mt-5 leading-7 text-muted">Проверьте подключение и попробуйте загрузить данные ещё раз.</p>
        <button type="button" className={buttonStyles("primary", "mt-8")} onClick={onRetry}><RefreshCw className="size-4" />Повторить</button>
      </div>
    </main>
  );
}

function EmptyPublishedPage({ title }: { title: string }) {
  return (
    <section className="section-space min-h-[60vh]">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <p className="eyebrow">Кемпинг Драйв</p>
        <h1 className="mt-4 font-display text-5xl">{title}</h1>
        <p className="mt-6 text-muted">Содержимое этой страницы скоро появится.</p>
      </div>
    </section>
  );
}

function updatePageMetadata(page: PublicPageData, settings: PublicSiteSettings): void {
  document.title = page.seoTitle || `${page.title} — ${settings.siteName}`;
  setMetaDescription(page.seoDescription || `${settings.siteName} — отдых на природе.`);
  setRobots("index, follow");

  const siteUrl = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
  const path = page.slug === "home" ? "/" : `/${page.slug}`;
  document.getElementById("canonical-url")?.setAttribute("href", siteUrl ? `${siteUrl}${path}` : path);
  setPropertyMeta("og:title", page.seoTitle || page.title);
  setPropertyMeta("og:description", page.seoDescription || `${settings.siteName} — отдых на природе.`);
  setPropertyMeta("og:url", siteUrl ? `${siteUrl}${path}` : path);
}

function setRobots(content: string): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "robots";
    document.head.append(meta);
  }
  meta.content = content;
}

function setMetaDescription(content: string): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "description";
    document.head.append(meta);
  }
  meta.content = content;
}

function setPropertyMeta(property: string, content: string): void {
  let meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.append(meta);
  }
  meta.content = content;
}
