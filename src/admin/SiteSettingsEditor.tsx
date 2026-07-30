import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, ExternalLink, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

import { cloneDefaultSiteSettings, type FloatingAction, type SiteLink, type SiteSettingsValue } from "../siteSettings";
import { AdminApiError, getImage, getSiteSettings, saveSiteSettings, type ImageAsset } from "./api";
import { ImageField } from "./ImageField";

export function SiteSettingsEditor() {
  const [value, setValue] = useState<SiteSettingsValue>(() => cloneDefaultSiteSettings());
  const [logo, setLogo] = useState<ImageAsset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setMessage(null);
    void getSiteSettings()
      .then(async (record) => {
        if (cancelled) return;
        setValue(record.value);
        setUpdatedAt(record.updatedAt);
        setLogo(null);
        if (record.value.logoImageId) {
          try {
            const image = await getImage(record.value.logoImageId);
            if (!cancelled) setLogo(image);
          } catch (error) {
            if (!cancelled) {
              setMessage({
                kind: "error",
                text: error instanceof AdminApiError && error.status === 404
                  ? "Сохранённый логотип не найден. Выберите новый файл перед следующей публикацией."
                  : "Не удалось показать логотип из медиатеки. Его выбор сохранён и не будет сброшен.",
              });
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить настройки");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadRevision]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDirty]);

  function change(mutator: (draft: SiteSettingsValue) => void) {
    setValue((current) => {
      const next = JSON.parse(JSON.stringify(current)) as SiteSettingsValue;
      mutator(next);
      return next;
    });
    setIsDirty(true);
    setMessage(null);
  }

  function selectLogo(image: ImageAsset | null) {
    setLogo(image);
    change((draft) => { draft.logoImageId = image?.id ?? null; });
  }

  async function save() {
    setIsSaving(true);
    setMessage(null);
    try {
      const record = await saveSiteSettings(value, updatedAt);
      setValue(record.value);
      setUpdatedAt(record.updatedAt);
      setIsDirty(false);
      setMessage({ kind: "success", text: "Настройки опубликованы на сайте" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Не удалось сохранить настройки" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <div className="admin-builder-loading" aria-live="polite"><LoaderCircle className="admin-spinner" size={22} />Загружаем настройки…</div>;
  }

  if (loadError) {
    return <section className="admin-site-settings"><header className="admin-pages-heading"><div><p className="admin-kicker">Оформление и контакты</p><h1>Настройки сайта</h1></div></header><div className="admin-pages-empty" role="alert"><AlertCircle size={28} /><h2>Не удалось загрузить настройки</h2><p>{loadError}. Редактор заблокирован, чтобы не перезаписать опубликованные данные.</p><button className="admin-primary-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Повторить</button></div></section>;
  }

  return (
    <section className="admin-site-settings" aria-labelledby="admin-site-settings-title">
      <header className="admin-pages-heading">
        <div>
          <p className="admin-kicker">Оформление и контакты</p>
          <h1 id="admin-site-settings-title">Настройки сайта</h1>
          <p>Изменения применяются ко всем опубликованным страницам и новостям после сохранения.</p>
        </div>
        <a className="admin-secondary-button admin-settings-preview-link" href="/" target="_blank" rel="noreferrer"><ExternalLink size={17} />Открыть сайт</a>
      </header>

      {message ? <div className={message.kind === "success" ? "admin-builder-success" : "admin-dashboard-error"} role={message.kind === "error" ? "alert" : "status"}>{message.kind === "success" ? <Check size={18} /> : <AlertCircle size={18} />}{message.text}</div> : null}

      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="admin-settings-fieldset" disabled={isSaving}>
        <SettingsCard title="Бренд и адрес" description="Название, логотип и данные, которые видны в шапке и подвале.">
          <div className="admin-settings-grid">
            <label className="admin-builder-field"><span>Название сайта</span><input required maxLength={100} value={value.siteName} onChange={(event) => change((draft) => { draft.siteName = event.target.value; })} /></label>
            <label className="admin-builder-field"><span>Подпись рядом с логотипом</span><input required maxLength={150} value={value.locationLabel} onChange={(event) => change((draft) => { draft.locationLabel = event.target.value; })} /></label>
            <div className="admin-builder-image-field"><ImageField label="Логотип" value={logo} onChange={selectLogo} /></div>
            <label className="admin-builder-field admin-builder-field-wide"><span>Alt-текст логотипа</span><input maxLength={200} value={value.logoAlt} onChange={(event) => change((draft) => { draft.logoAlt = event.target.value; })} /><small>Кратко опишите изображение для доступности. При декоративном логотипе поле можно оставить пустым.</small></label>
            <label className="admin-builder-field"><span>Адрес</span><input required maxLength={300} value={value.address} onChange={(event) => change((draft) => { draft.address = event.target.value; })} /></label>
            <label className="admin-builder-field"><span>Ссылка на маршрут</span><input required maxLength={2000} value={value.routeUrl} onChange={(event) => change((draft) => { draft.routeUrl = event.target.value; })} /></label>
          </div>
        </SettingsCard>

        <SettingsCard title="Телефоны" description="Первый номер считается основным и используется в шапке и кнопке звонка.">
          <div className="admin-settings-repeater">
            {value.phones.map((phone, index) => <RepeaterItem key={index} title={`Телефон ${index + 1}`} onRemove={value.phones.length > 1 ? () => change((draft) => { draft.phones.splice(index, 1); }) : undefined} moveUp={index > 0 ? () => change((draft) => { draft.phones = moved(draft.phones, index, -1); }) : undefined} moveDown={index < value.phones.length - 1 ? () => change((draft) => { draft.phones = moved(draft.phones, index, 1); }) : undefined}>
              <label className="admin-builder-field"><span>Подпись</span><input required maxLength={80} value={phone.label} onChange={(event) => change((draft) => { draft.phones[index]!.label = event.target.value; })} /></label>
              <label className="admin-builder-field"><span>Отображаемый номер</span><input required maxLength={80} value={phone.display} onChange={(event) => change((draft) => { draft.phones[index]!.display = event.target.value; })} /></label>
              <label className="admin-builder-field admin-builder-field-wide"><span>Ссылка для звонка</span><input required maxLength={2000} placeholder="tel:+79990000000" value={phone.href} onChange={(event) => change((draft) => { draft.phones[index]!.href = event.target.value; })} /></label>
            </RepeaterItem>)}
            <AddButton disabled={value.phones.length >= 5} onClick={() => change((draft) => { draft.phones.push({ label: "Дополнительный телефон", display: "+7 ", href: "tel:+7" }); })}>Добавить телефон</AddButton>
          </div>
        </SettingsCard>

        <SettingsCard title="Основное меню" description="Пункты можно добавлять, удалять и менять местами. Допустимы внутренние и внешние ссылки.">
          <LinkRepeater items={value.menu} max={12} onChange={(items) => change((draft) => { draft.menu = items; })} addLabel="Добавить пункт меню" minimum={1} />
        </SettingsCard>

        <SettingsCard title="Ссылки в контактах" description="Социальные сети, отзывы, партнёры и другие полезные адреса отображаются в контактной части подвала.">
          <LinkRepeater items={value.contactLinks} max={12} onChange={(items) => change((draft) => { draft.contactLinks = items; })} addLabel="Добавить ссылку" />
        </SettingsCard>

        <SettingsCard title="Подвал" description="Описание, колонки ссылок и нижняя служебная строка.">
          <div className="admin-settings-grid">
            <label className="admin-builder-field admin-builder-field-wide"><span>Описание</span><textarea rows={4} maxLength={1000} value={value.footer.description} onChange={(event) => change((draft) => { draft.footer.description = event.target.value; })} /></label>
            <label className="admin-builder-field admin-builder-field-wide"><span>Нижняя строка</span><input maxLength={500} value={value.footer.legalText} onChange={(event) => change((draft) => { draft.footer.legalText = event.target.value; })} /></label>
          </div>
          <div className="admin-settings-repeater admin-footer-columns">
            {value.footer.columns.map((column, columnIndex) => <RepeaterItem key={columnIndex} title={`Колонка ${columnIndex + 1}`} onRemove={() => change((draft) => { draft.footer.columns.splice(columnIndex, 1); })} moveUp={columnIndex > 0 ? () => change((draft) => { draft.footer.columns = moved(draft.footer.columns, columnIndex, -1); }) : undefined} moveDown={columnIndex < value.footer.columns.length - 1 ? () => change((draft) => { draft.footer.columns = moved(draft.footer.columns, columnIndex, 1); }) : undefined}>
              <label className="admin-builder-field admin-builder-field-wide"><span>Заголовок колонки</span><input required maxLength={100} value={column.title} onChange={(event) => change((draft) => { draft.footer.columns[columnIndex]!.title = event.target.value; })} /></label>
              <div className="admin-builder-field admin-builder-field-wide"><span>Ссылки колонки</span><LinkRepeater compact items={column.links} max={10} onChange={(items) => change((draft) => { draft.footer.columns[columnIndex]!.links = items; })} addLabel="Добавить ссылку в колонку" /></div>
            </RepeaterItem>)}
            <AddButton disabled={value.footer.columns.length >= 6} onClick={() => change((draft) => { draft.footer.columns.push({ title: "Новая колонка", links: [] }); })}>Добавить колонку</AddButton>
          </div>
        </SettingsCard>

        <SettingsCard title="Плавающие кнопки связи" description="Показываются внизу мобильного экрана. Можно настроить порядок, вид, назначение и акцент.">
          <div className="admin-settings-repeater">
            {value.floatingActions.map((action, index) => <RepeaterItem key={index} title={`Кнопка ${index + 1}`} onRemove={() => change((draft) => { draft.floatingActions.splice(index, 1); })} moveUp={index > 0 ? () => change((draft) => { draft.floatingActions = moved(draft.floatingActions, index, -1); }) : undefined} moveDown={index < value.floatingActions.length - 1 ? () => change((draft) => { draft.floatingActions = moved(draft.floatingActions, index, 1); }) : undefined}>
              <label className="admin-builder-field"><span>Текст</span><input required maxLength={40} value={action.label} onChange={(event) => change((draft) => { draft.floatingActions[index]!.label = event.target.value; })} /></label>
              <label className="admin-builder-field"><span>Иконка</span><select value={action.icon} onChange={(event) => change((draft) => { draft.floatingActions[index]!.icon = event.target.value as FloatingAction["icon"]; })}><option value="phone">Телефон</option><option value="route">Маршрут</option><option value="contacts">Контакты</option><option value="message">Сообщение</option><option value="link">Ссылка</option></select></label>
              <label className="admin-builder-field"><span>Действие</span><select value={action.linkType} onChange={(event) => change((draft) => { draft.floatingActions[index]!.linkType = event.target.value as FloatingAction["linkType"]; })}><option value="primaryPhone">Основной телефон</option><option value="route">Маршрут</option><option value="contacts">Контакты в подвале</option><option value="custom">Своя ссылка</option></select></label>
              <label className="admin-builder-field"><span>Своя ссылка</span><input maxLength={2000} disabled={action.linkType !== "custom"} placeholder="https://… или /страница" value={action.href} onChange={(event) => change((draft) => { draft.floatingActions[index]!.href = event.target.value; })} /></label>
              <label className="admin-settings-check"><input type="checkbox" checked={action.enabled} onChange={(event) => change((draft) => { draft.floatingActions[index]!.enabled = event.target.checked; })} /><span>Показывать кнопку</span></label>
              <label className="admin-settings-check"><input type="checkbox" checked={action.highlighted} onChange={(event) => change((draft) => { draft.floatingActions[index]!.highlighted = event.target.checked; })} /><span>Выделить светлым фоном</span></label>
            </RepeaterItem>)}
            <AddButton disabled={value.floatingActions.length >= 5} onClick={() => change((draft) => { draft.floatingActions.push({ label: "Связаться", icon: "message", linkType: "custom", href: "/#contacts", enabled: true, highlighted: false }); })}>Добавить кнопку</AddButton>
          </div>
        </SettingsCard>

        <SettingsCard title="SEO новостей" description="Общие заголовок и описание страницы со списком новостей. SEO отдельных страниц и публикаций редактируется внутри соответствующего материала.">
          <div className="admin-settings-grid">
            <label className="admin-builder-field admin-builder-field-wide"><span>SEO-заголовок списка новостей</span><input required maxLength={300} value={value.newsSeo.title} onChange={(event) => change((draft) => { draft.newsSeo.title = event.target.value; })} /><small>{value.newsSeo.title.length}/300</small></label>
            <label className="admin-builder-field admin-builder-field-wide"><span>SEO-описание списка новостей</span><textarea required rows={4} maxLength={500} value={value.newsSeo.description} onChange={(event) => change((draft) => { draft.newsSeo.description = event.target.value; })} /><small>{value.newsSeo.description.length}/500</small></label>
            <p className="admin-settings-seo-links"><a href="/admin/pages">SEO страниц</a><a href="/admin/news">SEO отдельных новостей</a></p>
          </div>
        </SettingsCard>
      </fieldset>

      <div className="admin-builder-savebar"><span>{isDirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}</span><button className="admin-primary-button" type="submit" disabled={!isDirty || isSaving}>{isSaving ? <LoaderCircle className="admin-spinner" size={17} /> : <Save size={17} />}{isSaving ? "Сохраняем…" : "Сохранить настройки"}</button></div>
      </form>
    </section>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="admin-settings-card"><header><h2>{title}</h2><p>{description}</p></header><div className="admin-settings-card-body">{children}</div></section>;
}

function RepeaterItem({ title, children, onRemove, moveUp, moveDown }: { title: string; children: ReactNode; onRemove?: () => void; moveUp?: () => void; moveDown?: () => void }) {
  return <article className="admin-settings-repeater-item"><header><strong>{title}</strong><div><button type="button" disabled={!moveUp} onClick={moveUp} aria-label="Переместить выше"><ArrowUp size={16} /></button><button type="button" disabled={!moveDown} onClick={moveDown} aria-label="Переместить ниже"><ArrowDown size={16} /></button>{onRemove ? <button className="is-danger" type="button" onClick={onRemove} aria-label="Удалить"><Trash2 size={16} /></button> : null}</div></header><div className="admin-settings-repeater-fields">{children}</div></article>;
}

function LinkRepeater({ items, onChange, addLabel, max, minimum = 0, compact = false }: { items: SiteLink[]; onChange: (items: SiteLink[]) => void; addLabel: string; max: number; minimum?: number; compact?: boolean }) {
  function update(index: number, key: keyof SiteLink, value: string) { const next = items.map((item) => ({ ...item })); next[index]![key] = value; onChange(next); }
  return <div className={compact ? "admin-link-repeater is-compact" : "admin-link-repeater"}>{items.map((item, index) => <article key={index} className="admin-link-row"><span className="admin-link-row-order">{index + 1}</span><label className="admin-builder-field"><span>Название</span><input required maxLength={100} value={item.label} onChange={(event) => update(index, "label", event.target.value)} /></label><label className="admin-builder-field"><span>Ссылка</span><input required maxLength={2000} value={item.href} onChange={(event) => update(index, "href", event.target.value)} /></label><div className="admin-link-row-actions"><button type="button" disabled={index === 0} onClick={() => onChange(moved(items, index, -1))} aria-label="Переместить выше"><ArrowUp size={15} /></button><button type="button" disabled={index === items.length - 1} onClick={() => onChange(moved(items, index, 1))} aria-label="Переместить ниже"><ArrowDown size={15} /></button><button className="is-danger" type="button" disabled={items.length <= minimum} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить"><Trash2 size={15} /></button></div></article>)}<AddButton disabled={items.length >= max} onClick={() => onChange([...items, { label: "Новая ссылка", href: "/" }])}>{addLabel}</AddButton></div>;
}

function AddButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button className="admin-secondary-button admin-settings-add" type="button" disabled={disabled} onClick={onClick}><Plus size={16} />{children}</button>;
}

function moved<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
