import { FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";

import {
  deleteImage,
  listImages,
  updateImageAltText,
  uploadImage,
  type ImageAsset,
  type ImageUploadConstraints,
} from "./api";

const defaultUploadConstraints: ImageUploadConstraints = {
  maxFileBytes: 15 * 1024 * 1024,
  maxInputPixels: 40_000_000,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};
const pageSize = 24;

type ImageLibraryProps = {
  mode?: "manage" | "select";
  selectedId?: string | null;
  onSelect?: (image: ImageAsset) => void;
  refreshKey?: number;
};

export function ImageLibrary({
  mode = "manage",
  selectedId,
  onSelect,
  refreshKey = 0,
}: ImageLibraryProps) {
  const headingId = useId();
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploadConstraints, setUploadConstraints] = useState(defaultUploadConstraints);
  const inputRef = useRef<HTMLInputElement>(null);
  const listGenerationRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generation = ++listGenerationRef.current;
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);
    void listImages({ search, limit: pageSize })
      .then((result) => {
        if (!cancelled && generation === listGenerationRef.current) {
          setImages(result.data);
          setTotal(result.pagination.total);
          setUploadConstraints(result.uploadConstraints);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled && generation === listGenerationRef.current) {
          setError(toMessage(requestError, "Не удалось загрузить медиатеку"));
        }
      })
      .finally(() => {
        if (!cancelled && generation === listGenerationRef.current) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, reloadKey, refreshKey]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    listGenerationRef.current += 1;
    if (nextSearch === search) {
      setReloadKey((value) => value + 1);
    } else {
      setSearch(nextSearch);
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || isUploading) return;

    setError(null);
    setNotice(null);
    const acceptedTypes = new Set(uploadConstraints.supportedMimeTypes);
    const invalid = files.find(
      (file) => !acceptedTypes.has(file.type) || file.size > uploadConstraints.maxFileBytes,
    );
    if (invalid) {
      setError(
        !acceptedTypes.has(invalid.type)
          ? `Файл «${invalid.name}» имеет неподдерживаемый формат`
          : `Файл «${invalid.name}» больше ${formatMegabytes(uploadConstraints.maxFileBytes)}`,
      );
      return;
    }

    setIsUploading(true);
    const uploadController = new AbortController();
    uploadAbortRef.current = uploadController;
    let uploaded = 0;
    const failures: string[] = [];
    for (const file of files) {
      if (uploadController.signal.aborted) break;
      try {
        await uploadImage(file, "", uploadController.signal);
        uploaded += 1;
      } catch (requestError) {
        if (uploadController.signal.aborted) break;
        failures.push(`${file.name}: ${toMessage(requestError, "ошибка загрузки")}`);
      }
    }
    if (uploadAbortRef.current === uploadController) {
      uploadAbortRef.current = null;
    }
    if (uploadController.signal.aborted) return;
    setIsUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (uploaded > 0) {
      listGenerationRef.current += 1;
      setNotice(`Загружено: ${uploaded}`);
      setSearchInput("");
      setSearch("");
      setReloadKey((value) => value + 1);
    }
    if (failures.length > 0) setError(failures.join(". "));
  }

  async function loadMore() {
    const generation = listGenerationRef.current;
    const requestedSearch = search;
    setIsLoadingMore(true);
    setError(null);
    try {
      const result = await listImages({ search, limit: pageSize, offset: images.length });
      if (generation !== listGenerationRef.current || requestedSearch !== search) return;
      setImages((current) => [...current, ...result.data]);
      setTotal(result.pagination.total);
      setUploadConstraints(result.uploadConstraints);
    } catch (requestError) {
      if (generation === listGenerationRef.current) {
        setError(toMessage(requestError, "Не удалось загрузить ещё изображения"));
      }
    } finally {
      if (generation === listGenerationRef.current) setIsLoadingMore(false);
    }
  }

  function replaceImage(updated: ImageAsset) {
    setImages((current) => current.map((image) => (image.id === updated.id ? updated : image)));
  }

  function removeImage(id: string) {
    listGenerationRef.current += 1;
    setImages((current) => current.filter((image) => image.id !== id));
    setTotal((current) => Math.max(0, current - 1));
    setNotice("Изображение удалено");
    setReloadKey((value) => value + 1);
  }

  return (
    <section className="admin-media-library" aria-labelledby={headingId}>
      <div className="admin-media-heading">
        <div>
          <p className="admin-kicker">{mode === "select" ? "Выбор из медиатеки" : "Управление файлами"}</p>
          <h1 id={headingId}>
            {mode === "select" ? "Выберите изображение" : "Изображения"}
          </h1>
          <p>JPEG, PNG и WebP до {formatMegabytes(uploadConstraints.maxFileBytes)}. После загрузки файлы автоматически оптимизируются.</p>
        </div>
        <span className="admin-media-count">{total} {pluralizeImages(total)}</span>
      </div>

      <label
        className={`admin-upload-zone${isDragging ? " is-dragging" : ""}${isUploading ? " is-busy" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={uploadConstraints.supportedMimeTypes.join(",")}
          multiple
          disabled={isUploading}
          onChange={(event) => event.target.files && void handleFiles(event.target.files)}
        />
        {isUploading ? <LoaderCircle className="admin-spinner" aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
        <span>
          <strong>{isUploading ? "Загружаем и оптимизируем…" : "Перетащите файлы сюда"}</strong>
          <small>{isUploading ? "Это может занять несколько секунд" : "или нажмите, чтобы выбрать"}</small>
        </span>
      </label>

      <div className="admin-media-toolbar">
        <form className="admin-media-search" onSubmit={handleSearch} role="search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Поиск по имени или alt-тексту"
            maxLength={200}
          />
          <button type="submit">Найти</button>
        </form>
        {search ? (
          <button className="admin-text-button" type="button" onClick={() => { listGenerationRef.current += 1; setSearchInput(""); setSearch(""); }}>
            Сбросить
          </button>
        ) : null}
      </div>

      {error ? <div className="admin-dashboard-error" role="alert"><AlertCircle size={18} />{error}</div> : null}
      {notice ? <div className="admin-media-notice" role="status"><Check size={18} />{notice}</div> : null}

      {isLoading ? (
        <div className="admin-media-loading" aria-live="polite"><LoaderCircle className="admin-spinner" /><span>Загружаем изображения…</span></div>
      ) : images.length === 0 ? (
        <div className="admin-media-empty">
          <FileImage size={38} aria-hidden="true" />
          <h2>{search ? "Ничего не найдено" : "Медиатека пока пуста"}</h2>
          <p>{search ? "Измените запрос или сбросьте поиск." : "Загрузите первое изображение с помощью поля выше."}</p>
        </div>
      ) : (
        <div className="admin-media-grid">
          {images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              mode={mode}
              isSelected={selectedId === image.id}
              onSelect={onSelect}
              onUpdated={replaceImage}
              onDeleted={removeImage}
            />
          ))}
        </div>
      )}

      {images.length < total ? (
        <button className="admin-load-more" type="button" disabled={isLoadingMore} onClick={() => void loadMore()}>
          {isLoadingMore ? <LoaderCircle className="admin-spinner" size={18} /> : <ImagePlus size={18} />}
          {isLoadingMore ? "Загружаем…" : "Показать ещё"}
        </button>
      ) : null}
    </section>
  );
}

function ImageCard({
  image,
  mode,
  isSelected,
  onSelect,
  onUpdated,
  onDeleted,
}: {
  image: ImageAsset;
  mode: "manage" | "select";
  isSelected: boolean;
  onSelect?: (image: ImageAsset) => void;
  onUpdated: (image: ImageAsset) => void;
  onDeleted: (id: string) => void;
}) {
  const [altText, setAltText] = useState(image.altText ?? "");
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = image.variants.thumbnail?.url ?? image.url;
  const hasAltChanges = altText.trim() !== (image.altText ?? "");

  useEffect(() => setAltText(image.altText ?? ""), [image.altText]);

  async function saveAltText() {
    setBusyAction("save");
    setError(null);
    try {
      onUpdated(await updateImageAltText(image.id, altText, image.updatedAt));
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось сохранить описание"));
    } finally {
      setBusyAction(null);
    }
  }

  async function remove() {
    if (image.usageCount > 0) return;
    if (!window.confirm(`Удалить «${image.originalFilename}» безвозвратно?`)) return;
    setBusyAction("delete");
    setError(null);
    try {
      await deleteImage(image.id, image.updatedAt);
      onDeleted(image.id);
    } catch (requestError) {
      setError(toMessage(requestError, "Не удалось удалить изображение"));
      setBusyAction(null);
    }
  }

  return (
    <article className={`admin-media-card${isSelected ? " is-selected" : ""}`}>
      <div className="admin-media-preview">
        <img src={preview} alt={image.altText || image.originalFilename} loading="lazy" />
        <span className={`admin-usage-badge${image.usageCount > 0 ? " is-used" : ""}`}>
          {image.usageCount > 0 ? `Используется: ${image.usageCount}` : "Не используется"}
        </span>
      </div>
      <div className="admin-media-card-body">
        <div className="admin-media-file-info">
          <strong title={image.originalFilename}>{image.originalFilename}</strong>
          <small>{image.width ?? "—"} × {image.height ?? "—"} · {formatBytes(Number(image.sizeBytes))}</small>
        </div>
        {mode === "manage" ? (
          <>
            <label className="admin-alt-field">
              <span>Alt-текст</span>
              <input value={altText} maxLength={500} onChange={(event) => setAltText(event.target.value)} placeholder="Кратко опишите изображение" />
            </label>
            {error ? <p className="admin-card-error" role="alert">{error}</p> : null}
            <div className="admin-media-card-actions">
              <button type="button" disabled={!hasAltChanges || busyAction !== null} onClick={() => void saveAltText()}>
                {busyAction === "save" ? <LoaderCircle className="admin-spinner" size={16} /> : <Check size={16} />}
                Сохранить
              </button>
              <button className="is-danger" type="button" disabled={image.usageCount > 0 || busyAction !== null} onClick={() => void remove()} title={image.usageCount > 0 ? "Сначала уберите изображение из контента" : undefined}>
                {busyAction === "delete" ? <LoaderCircle className="admin-spinner" size={16} /> : <Trash2 size={16} />}
                Удалить
              </button>
            </div>
          </>
        ) : (
          <button className="admin-select-image" type="button" onClick={() => onSelect?.(image)}>
            {isSelected ? <Check size={17} /> : <FileImage size={17} />}
            {isSelected ? "Выбрано" : "Выбрать"}
          </button>
        )}
      </div>
    </article>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} Б`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} МБ`;
}

function pluralizeImages(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "изображений";
  if (mod10 === 1) return "изображение";
  if (mod10 >= 2 && mod10 <= 4) return "изображения";
  return "изображений";
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
