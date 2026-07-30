import { useState } from "react";
import { AlertCircle, Check, FileStack, Images, LoaderCircle, LogOut, Newspaper, Settings2, ShieldCheck } from "lucide-react";

import {
  logoutAdministrator,
  updateImageAltText,
  type Administrator,
  type ImageAsset,
} from "./api";
import { ImageField } from "./ImageField";
import { ImageLibrary } from "./ImageLibrary";
import { NewsManager } from "./NewsManager";
import { PagesManager } from "./PageBuilder";
import { SiteSettingsEditor } from "./SiteSettingsEditor";

type AdminDashboardProps = {
  administrator: Administrator;
};

export function AdminDashboard({ administrator }: AdminDashboardProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const isPagesSection = window.location.pathname === "/admin/pages" || window.location.pathname.startsWith("/admin/pages/");
  const isNewsSection = window.location.pathname === "/admin/news" || window.location.pathname.startsWith("/admin/news/");
  const isSettingsSection = window.location.pathname === "/admin/settings" || window.location.pathname.startsWith("/admin/settings/");
  const isImagesSection = !isPagesSection && !isNewsSection && !isSettingsSection;

  async function handleLogout() {
    setError(null);
    setIsLoggingOut(true);

    try {
      await logoutAdministrator();
      window.location.replace("/admin/login");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выйти");
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="admin-dashboard-shell">
      <header className="admin-dashboard-header">
        <a className="admin-brand admin-brand-compact" href="/admin">
          <span className="admin-brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Camping Drive</strong>
            <small>Админ-панель</small>
          </span>
        </a>

        <div className="admin-account-actions">
          <span className="admin-account-name">{administrator.login}</span>
          <button
            className="admin-secondary-button"
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            <LogOut size={17} aria-hidden="true" />
            {isLoggingOut ? "Выходим…" : "Выйти"}
          </button>
        </div>
      </header>

      <main className="admin-dashboard-content">
        {error ? (
          <div className="admin-dashboard-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <nav className="admin-section-nav" aria-label="Разделы админ-панели">
          <a className={isImagesSection ? "is-active" : ""} href="/admin" aria-current={isImagesSection ? "page" : undefined}><Images size={18} />Изображения</a>
          <a className={isPagesSection ? "is-active" : ""} href="/admin/pages" aria-current={isPagesSection ? "page" : undefined}><FileStack size={18} />Страницы</a>
          <a className={isNewsSection ? "is-active" : ""} href="/admin/news" aria-current={isNewsSection ? "page" : undefined}><Newspaper size={18} />Новости</a>
          <a className={isSettingsSection ? "is-active" : ""} href="/admin/settings" aria-current={isSettingsSection ? "page" : undefined}><Settings2 size={18} />Настройки</a>
        </nav>
        {isPagesSection ? (
          <PagesManager />
        ) : isNewsSection ? (
          <NewsManager />
        ) : isSettingsSection ? (
          <SiteSettingsEditor />
        ) : (
          <>
            <ImageMetadataEditor onSaved={() => setLibraryRevision((value) => value + 1)} />
            <ImageLibrary refreshKey={libraryRevision} />
          </>
        )}
      </main>
    </div>
  );
}

function ImageMetadataEditor({ onSaved }: { onSaved: () => void }) {
  const [image, setImage] = useState<ImageAsset | null>(null);
  const [altText, setAltText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function selectImage(nextImage: ImageAsset | null) {
    setImage(nextImage);
    setAltText(nextImage?.altText ?? "");
    setMessage(null);
  }

  async function save() {
    if (!image) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const updated = await updateImageAltText(image.id, altText, image.updatedAt);
      setImage(updated);
      setMessage("Описание сохранено");
      onSaved();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="admin-image-editor" aria-labelledby="admin-image-editor-title">
      <div>
        <p className="admin-kicker">Поле редактора</p>
        <h2 id="admin-image-editor-title">Выбор из медиатеки</h2>
        <p>Откройте picker, выберите файл и сохраните его alt-текст.</p>
      </div>
      <div className="admin-image-editor-form">
        <ImageField label="Изображение" value={image} onChange={selectImage} />
        {image ? (
          <>
            <label className="admin-editor-alt-field">
              <span>Alt-текст</span>
              <input value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={500} />
            </label>
            <button className="admin-primary-button" type="button" disabled={isSaving || altText.trim() === (image.altText ?? "")} onClick={() => void save()}>
              {isSaving ? <LoaderCircle className="admin-spinner" size={17} /> : <Check size={17} />}
              {isSaving ? "Сохраняем…" : "Сохранить"}
            </button>
          </>
        ) : null}
        {message ? <p className="admin-editor-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
