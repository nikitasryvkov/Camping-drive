import { type FormEvent, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  EyeOff,
  LoaderCircle,
  Newspaper,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
} from "lucide-react";

import {
  createNewsItem,
  deleteNewsItem,
  getImage,
  getNewsItem,
  listNews,
  updateNewsItem,
  type ImageAsset,
  type NewsInput,
  type NewsItem,
  type NewsSummary,
  type NewsStatus,
} from "./api";
import { ImageField } from "./ImageField";
import { publicationDateForSave, toDateTimeLocal } from "./newsDate";

const pageSize = 20;

export function NewsManager() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/admin/news/new") return <NewsEditor />;
  const match = /^\/admin\/news\/([1-9]\d*)$/.exec(path);
  if (match) return <NewsEditor newsId={match[1]!} />;
  return <NewsListScreen />;
}

function NewsListScreen() {
  const [items, setItems] = useState<NewsSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | NewsStatus>("all");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listNews({ search, status: status === "all" ? undefined : status, limit: pageSize, offset })
      .then((result) => {
        if (cancelled) return;
        setItems(result.data);
        setTotal(result.pagination.total);
      })
      .catch((requestError) => {
        if (!cancelled) setError(toMessage(requestError, "Не удалось загрузить новости"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, reloadKey, search, status]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  async function removeItem(item: NewsSummary) {
    if (!window.confirm(`Удалить новость «${item.title}»? Это действие нельзя отменить.`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      await deleteNewsItem(item.id, item.updatedAt);
      const nextTotal = Math.max(0, total - 1);
      setTotal(nextTotal);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      const nextOffset = offset > 0 && offset >= nextTotal ? Math.max(0, offset - pageSize) : offset;
      if (nextOffset !== offset) setOffset(nextOffset);
      else setReloadKey((value) => value + 1);
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось удалить новость"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="admin-pages" aria-labelledby="admin-news-title">
      <div className="admin-pages-heading">
        <div>
          <p className="admin-kicker">Редакция</p>
          <h1 id="admin-news-title">Новости</h1>
          <p>Готовьте публикации, сохраняйте черновики и управляйте датой выхода.</p>
        </div>
        <a className="admin-primary-button" href="/admin/news/new"><Plus size={18} />Новая новость</a>
      </div>

      <div className="admin-pages-toolbar">
        <form className="admin-media-search" role="search" onSubmit={handleSearch}>
          <Search size={18} />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} type="search" placeholder="Заголовок, анонс или URL" maxLength={200} />
          <button type="submit">Найти</button>
        </form>
        <label className="admin-status-filter">
          <span>Статус</span>
          <select value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value as "all" | NewsStatus); }}>
            <option value="all">Все</option>
            <option value="draft">Черновики</option>
            <option value="published">Опубликованные</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="admin-news-list-error">
          <AdminMessage kind="error">{error}</AdminMessage>
          <button className="admin-secondary-button" type="button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={17} />Повторить</button>
        </div>
      ) : isLoading ? (
        <div className="admin-builder-loading"><LoaderCircle className="admin-spinner" /><span>Загружаем новости…</span></div>
      ) : items.length === 0 ? (
        <div className="admin-pages-empty">
          <Newspaper size={34} aria-hidden="true" />
          <h2>{search || status !== "all" ? "Новости не найдены" : "Создайте первую новость"}</h2>
          <p>{search || status !== "all" ? "Измените фильтры или поисковый запрос." : "Добавьте заголовок, обложку и текст, затем сохраните черновик или опубликуйте материал."}</p>
          {!search && status === "all" ? <a className="admin-primary-button" href="/admin/news/new"><Plus size={18} />Создать новость</a> : null}
        </div>
      ) : (
        <div className="admin-page-list">
          <div className="admin-page-list-caption">Показано {offset + 1}–{Math.min(offset + items.length, total)} из {total}</div>
          {items.map((item) => (
            <article className="admin-page-row" key={item.id}>
              <div className="admin-page-row-main">
                <div className="admin-page-row-title">
                  <h2><a href={`/admin/news/${item.id}`}>{item.title}</a></h2>
                  <StatusBadge status={item.status} publishedAt={item.publishedAt} />
                </div>
                <code>/news/{item.slug}</code>
                <small>{item.status === "published" && item.publishedAt ? `${isScheduled(item.publishedAt) ? "Запланировано" : "Опубликовано"} ${formatDate(item.publishedAt)}` : `Изменено ${formatDate(item.updatedAt)}`}</small>
              </div>
              <div className="admin-page-row-actions">
                {isPubliclyVisible(item) ? <a className="admin-icon-button" href={`/news/${item.slug}`} target="_blank" rel="noreferrer" aria-label={`Открыть новость ${item.title} на сайте`}><ExternalLink size={17} /></a> : null}
                <a className="admin-secondary-button" href={`/admin/news/${item.id}`}>Редактировать</a>
                <button className="admin-icon-button is-danger" type="button" disabled={deletingId !== null} onClick={() => void removeItem(item)} aria-label={`Удалить новость ${item.title}`}>
                  {deletingId === item.id ? <LoaderCircle className="admin-spinner" size={17} /> : <Trash2 size={17} />}
                </button>
              </div>
            </article>
          ))}
          {total > pageSize ? (
            <nav className="admin-page-pagination" aria-label="Пагинация новостей">
              <button className="admin-secondary-button" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={16} />Назад</button>
              <span>Страница {Math.floor(offset / pageSize) + 1} из {Math.ceil(total / pageSize)}</span>
              <button className="admin-secondary-button" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Вперёд<ArrowRight size={16} /></button>
            </nav>
          ) : null}
        </div>
      )}
    </section>
  );
}

function NewsEditor({ newsId }: { newsId?: string }) {
  const isNew = newsId === undefined;
  const [item, setItem] = useState<NewsItem | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [coverImage, setCoverImage] = useState<ImageAsset | null>(null);
  const [coverImageId, setCoverImageId] = useState<string | null>(null);
  const [coverLoadError, setCoverLoadError] = useState(false);
  const [publishedAt, setPublishedAt] = useState("");
  const [originalPublishedAt, setOriginalPublishedAt] = useState<string | null>(null);
  const [publishedAtWasEdited, setPublishedAtWasEdited] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!newsId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getNewsItem(newsId)
      .then(async (result) => {
        let image: ImageAsset | null = null;
        if (result.coverImageId) {
          try {
            image = await getImage(result.coverImageId);
          } catch {
            image = null;
            if (!cancelled) setCoverLoadError(true);
          }
        }
        if (cancelled) return;
        setItem(result);
        setTitle(result.title);
        setSlug(result.slug);
        setSlugWasEdited(true);
        setExcerpt(result.excerpt);
        setContent(result.content);
        setCoverImage(image);
        setCoverImageId(result.coverImageId);
        setPublishedAt(toDateTimeLocal(result.publishedAt));
        setOriginalPublishedAt(result.publishedAt);
        setPublishedAtWasEdited(false);
        setSeoTitle(result.seoTitle ?? "");
        setSeoDescription(result.seoDescription ?? "");
        setIsDirty(false);
      })
      .catch((requestError) => {
        if (!cancelled) setError(toMessage(requestError, "Не удалось загрузить новость"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [newsId]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setIsDirty(true);
    setNotice(null);
  }

  function changeCover(image: ImageAsset | null) {
    setCoverImage(image);
    setCoverImageId(image?.id ?? null);
    setCoverLoadError(false);
    setIsDirty(true);
    setNotice(null);
  }

  async function persist(status: NewsStatus) {
    const normalizedSlug = normalizeSlug(slug || title);
    if (!title.trim() || !normalizedSlug) {
      setError("Укажите заголовок и корректный URL новости");
      return;
    }
    if (status === "published" && (!excerpt.trim() || !content.trim())) {
      setError("Перед публикацией заполните анонс и текст новости");
      return;
    }
    let publicationDate: string | null;
    try {
      publicationDate = publicationDateForSave(
        publishedAt,
        originalPublishedAt,
        publishedAtWasEdited,
      );
    } catch {
      setError("Укажите корректную дату публикации");
      return;
    }
    const input: NewsInput = {
      title: title.trim(),
      slug: normalizedSlug,
      excerpt: excerpt.trim(),
      content,
      coverImageId,
      status,
      publishedAt: publicationDate,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
    };
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = isNew
        ? await createNewsItem(input)
        : await updateNewsItem(newsId!, { ...input, expectedUpdatedAt: item!.updatedAt });
      setIsDirty(false);
      if (isNew) {
        window.location.replace(`/admin/news/${saved.id}`);
        return;
      }
      setItem(saved);
      setTitle(saved.title);
      setSlug(saved.slug);
      setExcerpt(saved.excerpt);
      setContent(saved.content);
      setCoverImageId(saved.coverImageId);
      setPublishedAt(toDateTimeLocal(saved.publishedAt));
      setOriginalPublishedAt(saved.publishedAt);
      setPublishedAtWasEdited(false);
      setSeoTitle(saved.seoTitle ?? "");
      setSeoDescription(saved.seoDescription ?? "");
      setNotice(status === "published" ? isScheduled(saved.publishedAt) ? "Публикация запланирована" : "Новость опубликована" : item?.status === "published" ? "Новость снята с публикации" : "Черновик сохранён");
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось сохранить новость"));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCurrentItem() {
    if (!newsId || !item || !window.confirm(`Удалить новость «${item.title}»? Это действие нельзя отменить.`)) return;
    setIsSaving(true);
    setError(null);
    try {
      await deleteNewsItem(newsId, item.updatedAt);
      setIsDirty(false);
      window.location.assign("/admin/news");
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось удалить новость"));
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <section className="admin-pages"><a className="admin-back-link" href="/admin/news"><ArrowLeft size={17} />К списку новостей</a><div className="admin-builder-loading"><LoaderCircle className="admin-spinner" /><span>Открываем редактор…</span></div></section>;
  }

  if (!isNew && !item) {
    return <section className="admin-pages"><a className="admin-back-link" href="/admin/news"><ArrowLeft size={17} />К списку новостей</a>{error ? <AdminMessage kind="error">{error}</AdminMessage> : null}</section>;
  }

  const currentStatus = item?.status ?? "draft";
  return (
    <section className="admin-builder admin-news-editor" aria-busy={isSaving}>
      <div className="admin-builder-topline">
        <div>
          <a className="admin-back-link" href="/admin/news"><ArrowLeft size={17} />К списку новостей</a>
          <div className="admin-builder-title-line"><h1>{isNew ? "Новая новость" : title || "Без заголовка"}</h1><StatusBadge status={currentStatus} publishedAt={item?.publishedAt ?? null} /></div>
          <code>/news/{slug}</code>
        </div>
        <div className="admin-builder-main-actions">
          {item && isPubliclyVisible(item) ? <a className="admin-secondary-button" href={`/news/${item.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={17} />Открыть на сайте</a> : null}
          <button className="admin-secondary-button" type="button" disabled={isSaving || (!isDirty && !isNew)} onClick={() => void persist(currentStatus)}>
            {isSaving ? <LoaderCircle className="admin-spinner" size={17} /> : <Save size={17} />}{currentStatus === "draft" ? "Сохранить черновик" : "Сохранить"}
          </button>
          {currentStatus === "published" ? (
            <button className="admin-secondary-button" type="button" disabled={isSaving} onClick={() => void persist("draft")}><EyeOff size={17} />Снять с публикации</button>
          ) : (
            <button className="admin-primary-button" type="button" disabled={isSaving} onClick={() => void persist("published")}><Send size={17} />Опубликовать</button>
          )}
        </div>
      </div>

      {error ? <AdminMessage kind="error">{error}</AdminMessage> : null}
      {notice ? <AdminMessage kind="success">{notice}</AdminMessage> : null}
      {isDirty ? <div className="admin-unsaved-note">Есть несохранённые изменения</div> : null}

      <fieldset className="admin-news-form" disabled={isSaving}>
        <div className="admin-news-main-fields">
          <label className="admin-builder-field admin-builder-field-wide">
            <span>Заголовок</span>
            <input autoFocus={isNew} value={title} maxLength={300} onChange={(event) => {
              const nextTitle = event.target.value;
              change(setTitle, nextTitle);
              if (!slugWasEdited) setSlug(normalizeSlug(nextTitle));
            }} required />
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>URL новости</span>
            <div className="admin-slug-input"><strong>/news/</strong><input value={slug} maxLength={200} onChange={(event) => { setSlugWasEdited(true); change(setSlug, normalizeSlug(event.target.value)); }} placeholder="letniy-festival" required /></div>
            <small>Строчные буквы, цифры и дефисы без пробелов.</small>
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>Анонс</span>
            <textarea value={excerpt} maxLength={1000} rows={5} onChange={(event) => change(setExcerpt, event.target.value)} placeholder="Короткое описание для списка новостей и блока на страницах" />
            <small>{excerpt.length} из 1000 символов</small>
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>Текст новости</span>
            <textarea className="admin-news-content-input" value={content} maxLength={1_000_000} rows={20} onChange={(event) => change(setContent, event.target.value)} placeholder="Основной текст публикации. Разделяйте абзацы пустой строкой." />
          </label>
        </div>

        <aside className="admin-news-sidebar">
          <div className="admin-news-sidebar-card">
            <p className="admin-kicker">Публикация</p>
            <label className="admin-builder-field">
              <span>Дата и время</span>
              <input
                type="datetime-local"
                value={publishedAt}
                onChange={(event) => {
                  setPublishedAtWasEdited(true);
                  change(setPublishedAt, event.target.value);
                }}
              />
              <small>Если оставить пустым, при первой публикации будет установлено текущее время.</small>
            </label>
          </div>
          <div className="admin-news-sidebar-card admin-builder-image-field">
            <ImageField label="Обложка" value={coverImage} onChange={changeCover} />
            {coverLoadError ? <div className="admin-cover-load-warning" role="status"><p>Не удалось загрузить данные обложки. При сохранении текущая связь останется без изменений.</p><button className="admin-secondary-button" type="button" onClick={() => changeCover(null)}>Снять обложку</button></div> : null}
          </div>
          <details className="admin-news-sidebar-card admin-seo-settings">
            <summary>SEO-настройки</summary>
            <label className="admin-builder-field"><span>SEO-заголовок <em>необязательно</em></span><input value={seoTitle} maxLength={300} onChange={(event) => change(setSeoTitle, event.target.value)} /></label>
            <label className="admin-builder-field"><span>SEO-описание <em>необязательно</em></span><textarea value={seoDescription} maxLength={500} rows={5} onChange={(event) => change(setSeoDescription, event.target.value)} /></label>
          </details>
          {!isNew ? <button className="admin-danger-button" type="button" disabled={isSaving} onClick={() => void removeCurrentItem()}><Trash2 size={17} />Удалить новость</button> : null}
        </aside>
      </fieldset>

      <div className="admin-builder-savebar">
        <span>{isDirty ? "Изменения ещё не сохранены" : isNew ? "Заполните материал и сохраните черновик" : `Последнее сохранение: ${formatDate(item!.updatedAt)}`}</span>
        <button className="admin-primary-button" type="button" disabled={isSaving || (!isDirty && !isNew)} onClick={() => void persist(currentStatus)}>
          {isSaving ? <LoaderCircle className="admin-spinner" size={18} /> : <Save size={18} />}{currentStatus === "draft" ? "Сохранить черновик" : "Сохранить изменения"}
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status, publishedAt }: { status: NewsStatus; publishedAt: string | null }) {
  return <span className={`admin-status-badge is-${status}`}>{status === "published" ? isScheduled(publishedAt) ? "Запланирована" : "Опубликована" : "Черновик"}</span>;
}

function AdminMessage({ kind, children }: { kind: "error" | "success"; children: string }) {
  return <div className={kind === "error" ? "admin-dashboard-error" : "admin-builder-success"} role={kind === "error" ? "alert" : "status"}>{kind === "error" ? <AlertCircle size={18} /> : <Check size={18} />}{children}</div>;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Ll}\p{Lo}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isScheduled(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function isPubliclyVisible(item: Pick<NewsItem, "status" | "publishedAt">): boolean {
  return item.status === "published" && item.publishedAt !== null && !isScheduled(item.publishedAt);
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
