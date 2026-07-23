import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Newspaper, RefreshCw } from "lucide-react";

import { FloatingActions } from "../components/FloatingActions";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { Container } from "../components/ui/Container";
import { buttonStyles } from "../components/ui/Button";
import { useSiteSettings } from "../SiteSettingsContext";
import type { PublicSiteSettings } from "../siteSettings";
import {
  getPublicNewsArticle,
  getPublicNewsList,
  PublicApiError,
  type PublicImageSources,
  type PublicNewsArticle,
  type PublicNewsList,
} from "./api";
import { NotFoundPage } from "./NotFoundPage";

const pageSize = 9;

type ListState =
  | { status: "loading" }
  | { status: "loaded"; result: PublicNewsList }
  | { status: "error" };

export function PublicNewsListPage() {
  const settings = useSiteSettings();
  const page = useMemo(() => pageFromSearch(window.location.search), []);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    updateListMetadata(page, settings);
  }, [page, settings]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void getPublicNewsList({ limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.data.length === 0 && page > 1) {
          window.location.replace(newsPageHref(Math.max(1, Math.ceil(result.pagination.total / pageSize))));
          return;
        }
        setState({ status: "loaded", result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [page, reloadKey]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);

  return (
    <PublicNewsShell>
      <section className="section-space min-h-[60vh]">
        <Container>
          <div className="max-w-4xl">
            <p className="eyebrow">Жизнь кемпинга</p>
            <h1 className="mt-5 font-display text-5xl leading-[1.02] sm:text-6xl lg:text-8xl">Новости</h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">События, новые форматы отдыха и всё важное из жизни «{settings.siteName}».</p>
          </div>

          {state.status === "loading" ? <NewsGridLoading /> : null}
          {state.status === "error" ? <NewsLoadError onRetry={retry} /> : null}
          {state.status === "loaded" && state.result.data.length === 0 ? <EmptyNews /> : null}
          {state.status === "loaded" && state.result.data.length > 0 ? (
            <>
              <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {state.result.data.map((item) => (
                  <a key={item.slug} href={`/news/${item.slug}`} className="group flex h-full flex-col overflow-hidden rounded-4xl border border-border bg-surface shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <div className="aspect-[16/10] overflow-hidden bg-surface-strong">
                      {item.coverImageUrl ? <img {...newsImageProps(item.coverImageSources, item.coverImageUrl, "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw")} alt={item.coverImageAlt || ""} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : <div className="flex size-full items-center justify-center"><Newspaper className="size-10 text-fire" aria-hidden="true" /></div>}
                    </div>
                    <div className="flex flex-1 flex-col p-6 sm:p-7">
                      <p className="text-xs font-bold uppercase tracking-[.14em] text-muted">{formatNewsDate(item.publishedAt)}</p>
                      <h2 className="mt-3 font-display text-2xl leading-tight sm:text-3xl">{item.title}</h2>
                      {item.excerpt ? <p className="mt-4 line-clamp-4 text-sm leading-7 text-muted">{item.excerpt}</p> : null}
                      <span className="mt-auto inline-flex items-center gap-2 pt-7 text-sm font-semibold">Читать<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
                    </div>
                  </a>
                ))}
              </div>
              <NewsPagination page={page} total={state.result.pagination.total} />
            </>
          ) : null}
        </Container>
      </section>
    </PublicNewsShell>
  );
}

type ArticleState =
  | { status: "loading" }
  | { status: "loaded"; article: PublicNewsArticle }
  | { status: "not-found" }
  | { status: "error" };

export function PublicNewsArticlePage({ slug }: { slug: string }) {
  const settings = useSiteSettings();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ArticleState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void getPublicNewsArticle(slug, controller.signal)
      .then((article) => {
        if (!controller.signal.aborted) {
          setState({ status: "loaded", article });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof PublicApiError && error.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [reloadKey, slug]);

  useEffect(() => {
    if (state.status === "loaded") updateArticleMetadata(state.article, settings);
    if (state.status === "not-found") updateNotFoundMetadata(settings.siteName);
  }, [settings, state]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  if (state.status === "not-found") return <NotFoundPage />;

  return (
    <PublicNewsShell>
      {state.status === "loading" ? <ArticleLoading /> : null}
      {state.status === "error" ? <section className="section-space min-h-[65vh]"><Container><NewsLoadError onRetry={retry} /></Container></section> : null}
      {state.status === "loaded" ? <NewsArticle article={state.article} /> : null}
    </PublicNewsShell>
  );
}

function PublicNewsShell({ children }: { children: React.ReactNode }) {
  return <><Navbar overlayAtTop={false} /><main className="pt-20">{children}</main><Footer /><FloatingActions /></>;
}

function NewsArticle({ article }: { article: PublicNewsArticle }) {
  const paragraphs = article.content.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <article>
      <header className="bg-surface py-16 sm:py-24 lg:py-28">
        <Container>
          <a href="/news" className="inline-flex items-center gap-2 text-sm font-semibold text-muted transition hover:text-foreground"><ArrowLeft className="size-4" />Все новости</a>
          <div className="mt-10 max-w-5xl">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-muted"><CalendarDays className="size-4 text-fire" />{formatNewsDate(article.publishedAt)}</p>
            <h1 className="mt-5 font-display text-5xl leading-[1.02] sm:text-6xl lg:text-8xl">{article.title}</h1>
            {article.excerpt ? <p className="mt-7 max-w-3xl text-lg leading-8 text-muted sm:text-xl sm:leading-9">{article.excerpt}</p> : null}
          </div>
        </Container>
      </header>
      {article.coverImageUrl ? <Container className="-mt-8 sm:-mt-12"><img {...newsImageProps(article.coverImageSources, article.coverImageUrl, "(min-width: 1280px) 1200px, 100vw")} alt={article.coverImageAlt || ""} className="max-h-[720px] w-full rounded-4xl object-cover shadow-soft" /></Container> : null}
      <section className="py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-3xl">
            {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => <p key={index} className="mt-7 whitespace-pre-line text-base leading-8 text-foreground first:mt-0 sm:text-lg sm:leading-9">{paragraph}</p>) : <p className="text-muted">Текст этой публикации скоро появится.</p>}
            <div className="mt-14 border-t border-border pt-8"><a href="/news" className={buttonStyles("secondary")}><ArrowLeft className="size-4" />К списку новостей</a></div>
          </div>
        </Container>
      </section>
    </article>
  );
}

function NewsPagination({ page, total }: { page: number; total: number }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-12 flex flex-wrap items-center justify-center gap-3" aria-label="Пагинация новостей">
      {page > 1 ? <a className={buttonStyles("secondary")} href={newsPageHref(page - 1)} rel="prev"><ArrowLeft className="size-4" />Назад</a> : <span className={buttonStyles("secondary", "pointer-events-none opacity-45")} aria-disabled="true"><ArrowLeft className="size-4" />Назад</span>}
      <span className="px-3 text-sm font-semibold text-muted">Страница {page} из {totalPages}</span>
      {page < totalPages ? <a className={buttonStyles("secondary")} href={newsPageHref(page + 1)} rel="next">Вперёд<ArrowRight className="size-4" /></a> : <span className={buttonStyles("secondary", "pointer-events-none opacity-45")} aria-disabled="true">Вперёд<ArrowRight className="size-4" /></span>}
    </nav>
  );
}

function newsImageProps(
  sources: PublicImageSources | null,
  fallback: string,
  sizes: string,
): { src: string; srcSet?: string; sizes?: string; width?: number; height?: number } {
  if (!sources) return { src: fallback };
  const selected = sources.medium ?? sources.original;
  const candidates = [sources.thumbnail, sources.medium, sources.original]
    .filter((source): source is NonNullable<typeof source> => Boolean(source?.url && source.width))
    .filter((source, index, values) => values.findIndex((item) => item.width === source.width) === index)
    .sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
  return {
    src: selected.url,
    ...(candidates.length > 1
      ? { srcSet: candidates.map((source) => `${source.url} ${source.width}w`).join(", "), sizes }
      : {}),
    ...(selected.width ? { width: selected.width } : {}),
    ...(selected.height ? { height: selected.height } : {}),
  };
}

function NewsGridLoading() {
  return <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Загружаем новости">{Array.from({ length: 6 }, (_, index) => <div key={index} className="min-h-[390px] animate-pulse rounded-4xl bg-surface" />)}</div>;
}

function ArticleLoading() {
  return <section className="section-space min-h-[70vh]" aria-busy="true"><Container><div className="h-4 w-32 animate-pulse rounded bg-surface-strong" /><div className="mt-10 h-16 max-w-4xl animate-pulse rounded-2xl bg-surface" /><div className="mt-5 h-8 max-w-2xl animate-pulse rounded-xl bg-surface" /><div className="mt-14 aspect-[16/7] animate-pulse rounded-4xl bg-surface" /></Container></section>;
}

function EmptyNews() {
  return <div className="mt-14 grid min-h-72 place-items-center rounded-4xl border border-dashed border-border bg-surface px-6 text-center"><div><Newspaper className="mx-auto size-10 text-fire" /><h2 className="mt-6 font-display text-3xl">Публикации скоро появятся</h2><p className="mt-3 text-muted">Мы уже готовим новости из жизни кемпинга.</p></div></div>;
}

function NewsLoadError({ onRetry }: { onRetry: () => void }) {
  return <div className="mt-14 rounded-4xl border border-border bg-surface p-8 text-center"><h2 className="font-display text-3xl">Не удалось загрузить новости</h2><p className="mt-3 text-muted">Проверьте подключение и попробуйте ещё раз.</p><button type="button" className={buttonStyles("primary", "mt-7")} onClick={onRetry}><RefreshCw className="size-4" />Повторить</button></div>;
}

function pageFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get("page");
  if (!raw || !/^[1-9]\d*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page <= 111_112 ? page : 1;
}

function newsPageHref(page: number): string {
  return page <= 1 ? "/news" : `/news?page=${page}`;
}

function formatNewsDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Новости" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function updateListMetadata(page: number, settings: PublicSiteSettings): void {
  const suffix = page > 1 ? ` — страница ${page}` : "";
  const title = `${settings.newsSeo.title}${suffix}`;
  document.title = title;
  setMeta("description", settings.newsSeo.description);
  setMeta("robots", "index, follow");
  setPropertyMeta("og:title", title);
  setPropertyMeta("og:description", settings.newsSeo.description);
  setCanonical(newsPageHref(page));
}

function updateArticleMetadata(article: PublicNewsArticle, settings: PublicSiteSettings): void {
  const title = article.seoTitle || `${article.title} — ${settings.siteName}`;
  const description = article.seoDescription || article.excerpt || `Новости кемпинга «${settings.siteName}».`;
  const path = `/news/${article.slug}`;
  document.title = title;
  setMeta("description", description);
  setMeta("robots", "index, follow");
  setPropertyMeta("og:title", title);
  setPropertyMeta("og:description", description);
  setPropertyMeta("og:type", "article");
  setPropertyMeta("og:url", absoluteUrl(path));
  if (article.coverImageUrl) setPropertyMeta("og:image", absoluteUrl(article.coverImageUrl));
  else document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.remove();
  setCanonical(path);
}

function updateNotFoundMetadata(siteName: string): void {
  document.title = `Новость не найдена — ${siteName}`;
  setMeta("description", "Запрошенная новость не найдена или ещё не опубликована.");
  setMeta("robots", "noindex, nofollow");
}

function setCanonical(path: string): void {
  const url = absoluteUrl(path);
  document.getElementById("canonical-url")?.setAttribute("href", url);
  setPropertyMeta("og:url", url);
}

function absoluteUrl(path: string): string {
  const siteUrl = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
  return siteUrl ? `${siteUrl}${path}` : path;
}

function setMeta(name: string, content: string): void {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
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
