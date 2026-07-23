import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  LoaderCircle,
  Monitor,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  createPage,
  deletePage,
  getPage,
  listPages,
  savePageBuilder,
  type EditablePage,
  type PageBlock,
  type PageBlockContent,
  type PageStatus,
  type PageSummary,
} from "./api";
import { BlockContentEditor } from "./BlockContentEditor";
import { BlockPreview } from "./BlockPreview";
import { BLOCK_DEFINITIONS, createDefaultBlockContent, getBlockDefinition } from "./pageBlocks";
import {
  getPageBudgetViolation,
  MAX_BUILDER_PAYLOAD_BYTES,
  MAX_PAGE_BLOCKS,
  type PageBudgetViolation,
} from "../../shared/page-limits.js";

const pageSize = 25;

export function PagesManager() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/admin/pages/new") return <CreatePageScreen />;
  const match = /^\/admin\/pages\/([1-9]\d*)$/.exec(path);
  if (match) return <PageEditorScreen pageId={match[1]!} />;
  return <PageListScreen />;
}

function PageListScreen() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | PageStatus>("all");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listPages({ search, status: status === "all" ? undefined : status, limit: pageSize, offset })
      .then((result) => {
        if (!cancelled) {
          setPages(result.data);
          setTotal(result.pagination.total);
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(toMessage(requestError, "Не удалось загрузить страницы"));
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

  async function removePage(page: PageSummary) {
    if (!window.confirm(`Удалить страницу «${page.title}» вместе со всеми блоками?`)) return;
    setDeletingId(page.id);
    setError(null);
    try {
      await deletePage(page.id, page.updatedAt);
      setPages((current) => current.filter((item) => item.id !== page.id));
      const nextTotal = Math.max(0, total - 1);
      setTotal(nextTotal);
      const nextOffset = offset > 0 && offset >= nextTotal ? Math.max(0, offset - pageSize) : offset;
      if (nextOffset !== offset) setOffset(nextOffset);
      else setReloadKey((value) => value + 1);
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось удалить страницу"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="admin-pages" aria-labelledby="admin-pages-title">
      <div className="admin-pages-heading">
        <div>
          <p className="admin-kicker">Конструктор сайта</p>
          <h1 id="admin-pages-title">Страницы</h1>
          <p>Создавайте страницы, собирайте их из блоков и публикуйте, когда всё готово.</p>
        </div>
        <a className="admin-primary-button" href="/admin/pages/new"><Plus size={18} />Новая страница</a>
      </div>

      <div className="admin-pages-toolbar">
        <form className="admin-media-search" role="search" onSubmit={handleSearch}>
          <Search size={18} />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} type="search" placeholder="Название или URL" maxLength={200} />
          <button type="submit">Найти</button>
        </form>
        <label className="admin-status-filter">
          <span>Статус</span>
          <select value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value as "all" | PageStatus); }}>
            <option value="all">Все</option>
            <option value="draft">Черновики</option>
            <option value="published">Опубликованные</option>
          </select>
        </label>
      </div>

      {error ? <AdminMessage kind="error">{error}</AdminMessage> : null}
      {isLoading ? (
        <div className="admin-builder-loading"><LoaderCircle className="admin-spinner" /><span>Загружаем страницы…</span></div>
      ) : pages.length === 0 ? (
        <div className="admin-pages-empty">
          <h2>{search || status !== "all" ? "Страницы не найдены" : "Создайте первую страницу"}</h2>
          <p>{search || status !== "all" ? "Измените фильтры или поисковый запрос." : "Добавьте название и URL, затем соберите содержимое из готовых блоков."}</p>
          {!search && status === "all" ? <a className="admin-primary-button" href="/admin/pages/new"><Plus size={18} />Создать страницу</a> : null}
        </div>
      ) : (
        <div className="admin-page-list">
          <div className="admin-page-list-caption">Показано {offset + 1}–{Math.min(offset + pages.length, total)} из {total}</div>
          {pages.map((page) => (
            <article className="admin-page-row" key={page.id}>
              <div className="admin-page-row-main">
                <div className="admin-page-row-title">
                  <h2><a href={`/admin/pages/${page.id}`}>{page.title}</a></h2>
                  <StatusBadge status={page.status} />
                </div>
                <code>/{page.slug}</code>
                <small>Изменено {formatDate(page.updatedAt)}</small>
              </div>
              <div className="admin-page-row-actions">
                <a className="admin-secondary-button" href={`/admin/pages/${page.id}`}>Редактировать</a>
                <button className="admin-icon-button is-danger" type="button" disabled={deletingId !== null} onClick={() => void removePage(page)} aria-label={`Удалить страницу ${page.title}`}>
                  {deletingId === page.id ? <LoaderCircle className="admin-spinner" size={17} /> : <Trash2 size={17} />}
                </button>
              </div>
            </article>
          ))}
          {total > pageSize ? (
            <nav className="admin-page-pagination" aria-label="Пагинация страниц">
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

function CreatePageScreen() {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedSlug = normalizeSlug(slug || title);
    if (!title.trim() || !normalizedSlug) {
      setError("Укажите название и корректный URL страницы");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const page = await createPage({
        title: title.trim(),
        slug: normalizedSlug,
        status: "draft",
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
      });
      window.location.assign(`/admin/pages/${page.id}`);
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось создать страницу"));
      setIsSaving(false);
    }
  }

  return (
    <section className="admin-page-create">
      <a className="admin-back-link" href="/admin/pages"><ArrowLeft size={17} />К списку страниц</a>
      <div className="admin-page-create-card">
        <p className="admin-kicker">Новая страница</p>
        <h1>Основные настройки</h1>
        <p>После создания откроется конструктор блоков.</p>
        {error ? <AdminMessage kind="error">{error}</AdminMessage> : null}
        <form className="admin-page-form" onSubmit={submit}>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>Название страницы</span>
            <input autoFocus value={title} maxLength={300} onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              if (!slugWasEdited) setSlug(normalizeSlug(nextTitle));
            }} placeholder="Например, Размещение" required />
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>URL страницы</span>
            <div className="admin-slug-input"><strong>/</strong><input value={slug} maxLength={200} onChange={(event) => { setSlugWasEdited(true); setSlug(normalizeSlug(event.target.value)); }} placeholder="accommodation" required /></div>
            <small>Строчные буквы, цифры и дефисы без пробелов.</small>
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>SEO-заголовок <em>необязательно</em></span>
            <input value={seoTitle} maxLength={300} onChange={(event) => setSeoTitle(event.target.value)} />
          </label>
          <label className="admin-builder-field admin-builder-field-wide">
            <span>SEO-описание <em>необязательно</em></span>
            <textarea value={seoDescription} maxLength={500} rows={4} onChange={(event) => setSeoDescription(event.target.value)} />
          </label>
          <div className="admin-create-actions">
            <a className="admin-secondary-button" href="/admin/pages">Отмена</a>
            <button className="admin-primary-button" type="submit" disabled={isSaving}>
              {isSaving ? <LoaderCircle className="admin-spinner" size={18} /> : <Plus size={18} />}
              {isSaving ? "Создаём…" : "Создать и открыть"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PageEditorScreen({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<EditablePage | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getPage(pageId)
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        setTitle(result.title);
        setSlug(result.slug);
        setSeoTitle(result.seoTitle ?? "");
        setSeoDescription(result.seoDescription ?? "");
        setBlocks(normalizePositions(result.blocks));
      })
      .catch((requestError) => {
        if (!cancelled) setError(toMessage(requestError, "Не удалось загрузить страницу"));
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  function changeMeta(setter: (value: string) => void, value: string) {
    setter(value);
    setIsDirty(true);
    setNotice(null);
  }

  function replaceBlock(blockId: string, update: (block: PageBlock) => PageBlock) {
    setBlocks((current) => current.map((block) => block.id === blockId ? update(block) : block));
    setIsDirty(true);
    setNotice(null);
  }

  function moveBlock(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= blocks.length || fromIndex === toIndex) return;
    setBlocks((current) => normalizePositions(moveItem(current, fromIndex, toIndex)));
    setIsDirty(true);
    setNotice(null);
  }

  function addBlock(type: string) {
    if (isSaving) return;
    if (blocks.length >= MAX_PAGE_BLOCKS) {
      setError(`На странице может быть не более ${MAX_PAGE_BLOCKS} блоков.`);
      return;
    }
    setError(null);
    const created = createDraftBlock(pageId, type, createDefaultBlockContent(type), true);
    setBlocks((current) => normalizePositions([...current, created]));
    setExpandedId(created.id);
    setIsDirty(true);
    setNotice("Блок добавлен в черновик. Настройте его и сохраните страницу.");
  }

  function duplicateBlock(block: PageBlock) {
    if (isSaving) return;
    if (blocks.length >= MAX_PAGE_BLOCKS) {
      setError(`На странице может быть не более ${MAX_PAGE_BLOCKS} блоков.`);
      return;
    }
    setError(null);
    const created = createDraftBlock(pageId, block.type, structuredClone(block.content), block.isVisible);
    setBlocks((current) => normalizePositions([...current, created]));
    setExpandedId(created.id);
    setIsDirty(true);
    setNotice("Копия блока добавлена в черновик.");
  }

  function removeBlock(block: PageBlock) {
    if (isSaving) return;
    if (!window.confirm(`Удалить блок «${getBlockDefinition(block.type)?.label ?? block.type}»?`)) return;
    setError(null);
    setBlocks((current) => normalizePositions(current.filter((item) => item.id !== block.id)));
    if (expandedId === block.id) setExpandedId(null);
    setIsDirty(true);
    setNotice("Блок удалён из черновика. Сохраните страницу, чтобы применить удаление.");
  }

  async function persist(nextStatus?: PageStatus): Promise<boolean> {
    if (!page) return false;
    const normalizedSlug = normalizeSlug(slug);
    if (!title.trim() || !normalizedSlug) {
      setError("Укажите название и корректный URL страницы");
      return false;
    }
    const invalidLinkBlock = blocks.find((block) => hasInvalidContentUrl(block.content));
    if (invalidLinkBlock) {
      setError(`Исправьте ссылку в блоке «${getBlockDefinition(invalidLinkBlock.type)?.label ?? invalidLinkBlock.type}»`);
      setExpandedId(invalidLinkBlock.id);
      return false;
    }
    const snapshot = normalizePositions(blocks);
    const budgetViolation = getPageBudgetViolation(snapshot);
    if (budgetViolation) {
      setError(pageBudgetMessage(budgetViolation));
      return false;
    }
    const payload = {
      title: title.trim(),
      slug: normalizedSlug,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      status: nextStatus ?? page.status,
      expectedUpdatedAt: page.updatedAt,
      blocks: snapshot.map((block) => ({
        ...(isPersistentId(block.id) ? { id: block.id } : {}),
        type: block.type,
        isVisible: block.isVisible,
        content: block.content,
      })),
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (payloadBytes > MAX_BUILDER_PAYLOAD_BYTES) {
      setError(`Страница занимает ${formatBytes(payloadBytes)}; предел сохранения — ${formatBytes(MAX_BUILDER_PAYLOAD_BYTES)}. Уменьшите объём текста или число элементов.`);
      return false;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updatedPage = await savePageBuilder(pageId, payload);
      setPage(updatedPage);
      setTitle(updatedPage.title);
      setSlug(updatedPage.slug);
      setSeoTitle(updatedPage.seoTitle ?? "");
      setSeoDescription(updatedPage.seoDescription ?? "");
      setBlocks(normalizePositions(updatedPage.blocks));
      setIsDirty(false);
      setNotice(nextStatus === "published" ? "Страница опубликована" : nextStatus === "draft" ? "Страница снята с публикации" : "Все изменения сохранены");
      return true;
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось сохранить страницу"));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCurrentPage() {
    if (!page || !window.confirm(`Удалить страницу «${page.title}» вместе со всеми блоками?`)) return;
    setIsSaving(true);
    setError(null);
    try {
      await deletePage(page.id, page.updatedAt);
      setIsDirty(false);
      window.location.assign("/admin/pages");
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось удалить страницу"));
      setIsSaving(false);
    }
  }

  if (!page) {
    return (
      <section className="admin-pages">
        <a className="admin-back-link" href="/admin/pages"><ArrowLeft size={17} />К списку страниц</a>
        {error ? <AdminMessage kind="error">{error}</AdminMessage> : <div className="admin-builder-loading"><LoaderCircle className="admin-spinner" /><span>Открываем конструктор…</span></div>}
      </section>
    );
  }

  return (
    <section className="admin-builder" aria-busy={isSaving}>
      <div className="admin-builder-topline">
        <div>
          <a className="admin-back-link" href="/admin/pages"><ArrowLeft size={17} />К списку страниц</a>
          <div className="admin-builder-title-line"><h1>{title || "Без названия"}</h1><StatusBadge status={page.status} /></div>
          <code>/{slug}</code>
        </div>
        <div className="admin-builder-main-actions">
          <button className="admin-secondary-button" type="button" onClick={() => setPreviewOpen(true)}><Monitor size={17} />Предпросмотр</button>
          <button className="admin-secondary-button" type="button" disabled={isSaving || !isDirty} onClick={() => void persist()}>
            {isSaving ? <LoaderCircle className="admin-spinner" size={17} /> : <Save size={17} />}Сохранить
          </button>
          {page.status === "published" ? (
            <button className="admin-secondary-button" type="button" disabled={isSaving} onClick={() => void persist("draft")}><EyeOff size={17} />Снять с публикации</button>
          ) : (
            <button className="admin-primary-button" type="button" disabled={isSaving} onClick={() => void persist("published")}><Send size={17} />Опубликовать</button>
          )}
        </div>
      </div>

      {error ? <AdminMessage kind="error">{error}</AdminMessage> : null}
      {notice ? <AdminMessage kind="success">{notice}</AdminMessage> : null}
      {isDirty ? <div className="admin-unsaved-note">Есть несохранённые изменения</div> : null}

      <div className="admin-builder-layout">
        <fieldset className="admin-page-settings admin-page-settings-fieldset" disabled={isSaving}>
          <p className="admin-kicker">Настройки страницы</p>
          <label className="admin-builder-field admin-builder-field-wide"><span>Название</span><input value={title} maxLength={300} onChange={(event) => changeMeta(setTitle, event.target.value)} /></label>
          <label className="admin-builder-field admin-builder-field-wide"><span>URL</span><div className="admin-slug-input"><strong>/</strong><input value={slug} maxLength={200} onChange={(event) => changeMeta(setSlug, normalizeSlug(event.target.value))} /></div></label>
          <details className="admin-seo-settings">
            <summary>SEO-настройки</summary>
            <label className="admin-builder-field admin-builder-field-wide"><span>SEO-заголовок</span><input value={seoTitle} maxLength={300} onChange={(event) => changeMeta(setSeoTitle, event.target.value)} /></label>
            <label className="admin-builder-field admin-builder-field-wide"><span>SEO-описание</span><textarea value={seoDescription} maxLength={500} rows={5} onChange={(event) => changeMeta(setSeoDescription, event.target.value)} /></label>
          </details>
          <button className="admin-danger-button" type="button" disabled={isSaving} onClick={() => void removeCurrentPage()}><Trash2 size={17} />Удалить страницу</button>
        </fieldset>

        <div className="admin-block-builder">
          <div className="admin-block-builder-heading"><div><p className="admin-kicker">Содержимое</p><h2>Блоки страницы</h2></div><span>{blocks.length}</span></div>

          {blocks.length === 0 ? (
            <div className="admin-blocks-empty"><h3>Страница пока пуста</h3><p>Добавьте первый блок из библиотеки ниже.</p></div>
          ) : (
            <div className="admin-block-list">
              {blocks.map((block, index) => (
                <BlockEditorCard
                  key={block.id}
                  block={block}
                  index={index}
                  total={blocks.length}
                  expanded={expandedId === block.id}
                  busy={isSaving}
                  duplicateDisabled={blocks.length >= MAX_PAGE_BLOCKS}
                  dragging={draggedId === block.id}
                  onToggle={() => setExpandedId((current) => current === block.id ? null : block.id)}
                  onChange={(content) => replaceBlock(block.id, (current) => ({ ...current, content }))}
                  onVisibility={() => replaceBlock(block.id, (current) => ({ ...current, isVisible: !current.isVisible }))}
                  onDuplicate={() => duplicateBlock(block)}
                  onDelete={() => removeBlock(block)}
                  onMove={(direction) => moveBlock(index, index + direction)}
                  onDragStart={() => setDraggedId(block.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDrop={() => {
                    if (!draggedId || draggedId === block.id) return;
                    const fromIndex = blocks.findIndex((item) => item.id === draggedId);
                    moveBlock(fromIndex, index);
                    setDraggedId(null);
                  }}
                />
              ))}
            </div>
          )}

          <BlockLibrary busy={isSaving || blocks.length >= MAX_PAGE_BLOCKS} onAdd={addBlock} />
        </div>
      </div>

      <div className="admin-builder-savebar">
        <span>{isDirty ? "Изменения ещё не сохранены" : `Сохранено · ${formatDate(page.updatedAt)}`}</span>
        <button className="admin-primary-button" type="button" disabled={isSaving || !isDirty} onClick={() => void persist()}>
          {isSaving ? <LoaderCircle className="admin-spinner" size={18} /> : <Save size={18} />}
          {isSaving ? "Сохраняем…" : "Сохранить страницу"}
        </button>
      </div>

      <PagePreviewDialog open={isPreviewOpen} title={title} blocks={blocks} onClose={() => setPreviewOpen(false)} />
    </section>
  );
}

function BlockEditorCard({
  block,
  index,
  total,
  expanded,
  busy,
  duplicateDisabled,
  dragging,
  onToggle,
  onChange,
  onVisibility,
  onDuplicate,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  block: PageBlock;
  index: number;
  total: number;
  expanded: boolean;
  busy: boolean;
  duplicateDisabled: boolean;
  dragging: boolean;
  onToggle: () => void;
  onChange: (content: PageBlockContent) => void;
  onVisibility: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const definition = useMemo(() => getBlockDefinition(block.type), [block.type]);
  return (
    <article
      className={`admin-block-card${!block.isVisible ? " is-hidden" : ""}${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); onDrop(); }}
    >
      <header className="admin-block-card-header">
        <button
          className="admin-block-drag"
          type="button"
          draggable={!busy}
          disabled={busy}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", block.id); onDragStart(); }}
          onDragEnd={onDragEnd}
          aria-label={`Перетащить блок ${definition?.label ?? block.type}`}
          title="Перетащите для изменения порядка"
        ><GripVertical size={19} /></button>
        <button className="admin-block-title" type="button" onClick={onToggle} aria-expanded={expanded}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><strong>{definition?.label ?? block.type}</strong><small>{block.isVisible ? definition?.description : "Скрыт на странице"}</small></div>
          {expanded ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
        </button>
        <div className="admin-block-actions">
          <button type="button" disabled={index === 0 || busy} onClick={() => onMove(-1)} aria-label="Поднять блок"><ArrowUp size={16} /></button>
          <button type="button" disabled={index === total - 1 || busy} onClick={() => onMove(1)} aria-label="Опустить блок"><ArrowDown size={16} /></button>
          <button type="button" disabled={busy} onClick={onVisibility} aria-label={block.isVisible ? "Скрыть блок" : "Показать блок"}>{block.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          <button type="button" disabled={busy || duplicateDisabled} onClick={onDuplicate} aria-label="Дублировать блок"><Copy size={16} /></button>
          <button className="is-danger" type="button" disabled={busy} onClick={onDelete} aria-label="Удалить блок"><Trash2 size={16} /></button>
        </div>
      </header>
      {expanded ? (
        <div className="admin-block-card-body">
          <fieldset className="admin-block-fieldset" disabled={busy}>
            {definition ? <BlockContentEditor instanceId={block.id} definition={definition} content={block.content} onChange={onChange} /> : <UnknownBlockEditor content={block.content} onChange={onChange} />}
          </fieldset>
        </div>
      ) : null}
    </article>
  );
}

function UnknownBlockEditor({ content, onChange }: { content: PageBlockContent; onChange: (content: PageBlockContent) => void }) {
  const [value, setValue] = useState(() => JSON.stringify(content, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="admin-builder-field admin-builder-field-wide">
      <span>JSON неизвестного типа блока</span>
      <textarea rows={12} value={value} onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        try {
          const parsed = JSON.parse(next) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          setError(null);
          onChange(parsed as PageBlockContent);
        } catch {
          setError("Введите корректный JSON-объект");
        }
      }} />
      {error ? <small className="admin-card-error">{error}</small> : null}
    </label>
  );
}

function BlockLibrary({ busy, onAdd }: { busy: boolean; onAdd: (type: string) => void }) {
  return (
    <section className="admin-block-library">
      <div><p className="admin-kicker">Библиотека блоков</p><h2>Добавить блок</h2><p>Выберите готовую структуру и заполните её содержимым.</p></div>
      <div className="admin-block-library-grid">
        {BLOCK_DEFINITIONS.map((definition) => (
          <button type="button" key={definition.type} disabled={busy} onClick={() => onAdd(definition.type)}>
            <span><Plus size={18} /></span>
            <strong>{definition.label}</strong>
            <small>{definition.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function pageBudgetMessage(violation: PageBudgetViolation): string {
  if (violation.kind === "blocks") {
    return `На странице ${violation.actual} блоков; разрешено не более ${violation.limit}.`;
  }
  if (violation.kind === "items") {
    return `В коллекциях страницы ${violation.actual} элементов; разрешено не более ${violation.limit}.`;
  }
  return `Содержимое блоков занимает ${formatBytes(violation.actual)}; предел — ${formatBytes(violation.limit)}.`;
}

function PagePreviewDialog({ open, title, blocks, onClose }: { open: boolean; title: string; blocks: PageBlock[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], summary, input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  const visibleBlocks = blocks.filter((block) => block.isVisible);
  return (
    <div className="admin-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="admin-preview-dialog" role="dialog" aria-modal="true" aria-label={`Предпросмотр страницы ${title}`} tabIndex={-1}>
        <header><div><small>Предпросмотр</small><strong>{title}</strong></div><button type="button" onClick={onClose} aria-label="Закрыть предпросмотр"><X /></button></header>
        <div className="admin-preview-canvas">
          {visibleBlocks.length > 0 ? visibleBlocks.map((block) => <BlockPreview key={block.id} block={block} />) : <div className="admin-preview-empty">Добавьте хотя бы один видимый блок.</div>}
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: PageStatus }) {
  return <span className={`admin-status-badge is-${status}`}>{status === "published" ? "Опубликована" : "Черновик"}</span>;
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

function normalizePositions(blocks: PageBlock[]): PageBlock[] {
  return blocks.map((block, position) => ({ ...block, position }));
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function createDraftBlock(
  pageId: string,
  type: string,
  content: PageBlockContent,
  isVisible: boolean,
): PageBlock {
  const timestamp = new Date().toISOString();
  return {
    id: `draft-${crypto.randomUUID()}`,
    pageId,
    type,
    position: 0,
    isVisible,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function isPersistentId(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function hasInvalidContentUrl(content: PageBlockContent): boolean {
  const pending: unknown[] = [content];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (key.toLocaleLowerCase().endsWith("url") && typeof value === "string" && value && !/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value.trim())) {
        return true;
      }
      pending.push(value);
    }
  }
  return false;
}

function formatBytes(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} МБ`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
