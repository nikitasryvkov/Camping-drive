import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { getImagesByIds, type ImageAsset, type PageBlockContent } from "./api";
import { ImageField } from "./ImageField";
import type { BlockDefinition, BlockField } from "./pageBlocks";

type BlockContentEditorProps = {
  instanceId: string;
  definition: BlockDefinition;
  content: PageBlockContent;
  onChange: (content: PageBlockContent) => void;
};

export function BlockContentEditor({ instanceId, definition, content, onChange }: BlockContentEditorProps) {
  const imageIdsKey = useMemo(() => collectImageIds(content).join(","), [content]);
  const [imagesById, setImagesById] = useState<Record<string, ImageAsset>>({});
  const [imageStatus, setImageStatus] = useState<ImageResolutionStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    const imageIds = imageIdsKey ? imageIdsKey.split(",") : [];
    if (imageIds.length === 0) {
      setImagesById({});
      setImageStatus("idle");
      return;
    }
    setImageStatus("loading");
    void getImagesByIds(imageIds)
      .then((images) => {
        if (cancelled) return;
        setImagesById(Object.fromEntries(images.map((image) => [image.id, image])));
        setImageStatus("loaded");
      })
      .catch(() => {
        if (!cancelled) setImageStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [imageIdsKey]);

  return (
    <div className="admin-block-fields">
      <FieldList
        fields={definition.fields}
        value={content}
        onChange={onChange}
        path={`${definition.type}-${instanceId}`}
        imagesById={imagesById}
        imageStatus={imageStatus}
      />
    </div>
  );
}

type ImageResolutionStatus = "idle" | "loading" | "loaded" | "error";

function FieldList({
  fields,
  value,
  onChange,
  path,
  imagesById,
  imageStatus,
}: {
  fields: BlockField[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  path: string;
  imagesById: Record<string, ImageAsset>;
  imageStatus: ImageResolutionStatus;
}) {
  function setField(key: string, nextValue: unknown) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <>
      {fields.map((field) => {
        const fieldId = `${path}-${field.key}`.replace(/[^a-zA-Z0-9_-]/g, "-");

        if (field.kind === "repeater") {
          const items = toRecordArray(value[field.key]);
          const maxItems = field.maxItems ?? 50;
          return (
            <fieldset className="admin-repeater" key={field.key}>
              <legend>{field.label}</legend>
              <div className="admin-repeater-items">
                {items.map((item, index) => (
                  <section className="admin-repeater-item" key={`${field.key}-${index}`}>
                    <div className="admin-repeater-item-heading">
                      <strong>{field.itemLabel} {index + 1}</strong>
                      <div>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => setField(field.key, moveItem(items, index, index - 1))}
                          aria-label={`Поднять ${field.itemLabel.toLocaleLowerCase()} ${index + 1}`}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          disabled={index === items.length - 1}
                          onClick={() => setField(field.key, moveItem(items, index, index + 1))}
                          aria-label={`Опустить ${field.itemLabel.toLocaleLowerCase()} ${index + 1}`}
                        >
                          <ArrowDown size={15} />
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          onClick={() => setField(field.key, items.filter((_, itemIndex) => itemIndex !== index))}
                          aria-label={`Удалить ${field.itemLabel.toLocaleLowerCase()} ${index + 1}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <FieldList
                      fields={field.fields}
                      value={item}
                      onChange={(nextItem) => {
                        const nextItems = [...items];
                        nextItems[index] = nextItem;
                        setField(field.key, nextItems);
                      }}
                      path={`${fieldId}-${index}`}
                      imagesById={imagesById}
                      imageStatus={imageStatus}
                    />
                  </section>
                ))}
              </div>
              <button
                className="admin-secondary-button admin-add-repeater"
                type="button"
                disabled={items.length >= maxItems}
                onClick={() => setField(field.key, [...items, structuredClone(field.defaultItem)])}
              >
                <Plus size={16} />
                {items.length >= maxItems ? `Достигнут лимит: ${maxItems}` : field.addLabel}
              </button>
            </fieldset>
          );
        }

        if (field.kind === "image") {
          return (
            <ContentImageField
              key={field.key}
              field={field}
              value={value}
              onChange={onChange}
              imagesById={imagesById}
              imageStatus={imageStatus}
            />
          );
        }

        if (field.kind === "select") {
          return (
            <label className="admin-builder-field" key={field.key} htmlFor={fieldId}>
              <span>{field.label}</span>
              <select
                id={fieldId}
                value={toText(value[field.key])}
                onChange={(event) => setField(field.key, event.target.value)}
              >
                {field.options.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          );
        }

        if (field.kind === "textarea") {
          return (
            <label className="admin-builder-field admin-builder-field-wide" key={field.key} htmlFor={fieldId}>
              <span>{field.label}</span>
              <textarea
                id={fieldId}
                rows={5}
                maxLength={field.maxLength ?? 20_000}
                value={toText(value[field.key])}
                placeholder={field.placeholder}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            </label>
          );
        }

        const currentValue = toText(value[field.key]);
        const invalidUrl = field.kind === "url" && currentValue !== "" && !isSafeUrl(currentValue);
        return (
          <label className="admin-builder-field" key={field.key} htmlFor={fieldId}>
            <span>{field.label}</span>
            <input
              id={fieldId}
              type={field.kind === "url" ? "text" : field.kind}
              inputMode={field.kind === "url" ? "url" : undefined}
              min={field.kind === "number" ? field.min : undefined}
              max={field.kind === "number" ? field.max : undefined}
              maxLength={field.kind === "number" ? undefined : field.maxLength ?? (field.kind === "url" ? 2_000 : 500)}
              value={currentValue}
              aria-invalid={invalidUrl || undefined}
              placeholder={field.placeholder}
              onChange={(event) => {
                const parsed = field.kind === "number"
                  ? event.target.value === "" ? field.min ?? 0 : Number(event.target.value)
                  : event.target.value;
                const nextValue = typeof parsed === "number" && Number.isFinite(parsed) && field.kind === "number"
                  ? Math.max(field.min ?? Number.MIN_SAFE_INTEGER, Math.min(field.max ?? Number.MAX_SAFE_INTEGER, Math.round(parsed)))
                  : parsed;
                setField(field.key, nextValue);
              }}
            />
            {invalidUrl ? <small className="admin-card-error">Ссылка должна начинаться с https://, http://, /, #, mailto: или tel:</small> : null}
          </label>
        );
      })}
    </>
  );
}

function ContentImageField({
  field,
  value,
  onChange,
  imagesById,
  imageStatus,
}: {
  field: Extract<BlockField, { kind: "image" }>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  imagesById: Record<string, ImageAsset>;
  imageStatus: ImageResolutionStatus;
}) {
  const imageId = toNullableText(value[`${field.key}Id`]);
  const resolvedImage = imageId ? imagesById[imageId] ?? null : null;
  const [image, setImage] = useState<ImageAsset | null>(resolvedImage);

  useEffect(() => {
    if (!imageId) {
      setImage(null);
      return;
    }
    if (resolvedImage) setImage(resolvedImage);
    else if (imageStatus === "loaded") setImage(null);
  }, [imageId, imageStatus, resolvedImage]);

  return (
    <div className="admin-builder-field admin-builder-image-field">
      <ImageField
        label={field.label}
        value={image}
        onChange={(nextImage) => {
          setImage(nextImage);
          onChange({
            ...value,
            [`${field.key}Id`]: nextImage?.id ?? null,
            [`${field.key}Url`]: nextImage?.variants.medium?.url ?? nextImage?.url ?? "",
            [`${field.key}Alt`]: nextImage?.altText ?? "",
          });
        }}
      />
      {imageId && !image && imageStatus === "loading" ? <small className="admin-field-hint">Загружаем изображение #{imageId}…</small> : null}
      {imageId && !image && imageStatus === "loaded" ? <small className="admin-field-hint">Изображение #{imageId} удалено или недоступно. Выберите другое.</small> : null}
      {imageId && !image && imageStatus === "error" ? <small className="admin-card-error">Не удалось загрузить изображение #{imageId}. Повторите попытку позже.</small> : null}
    </div>
  );
}

function toText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function toNullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function isSafeUrl(value: string): boolean {
  return /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value.trim());
}

function collectImageIds(value: unknown): string[] {
  const ids = new Set<string>();
  visit(value);
  return [...ids].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

  function visit(candidate: unknown): void {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (/image(?:night)?id$/i.test(key)) {
        const id = toNullableText(nested);
        if (id && /^[1-9]\d{0,18}$/.test(id)) ids.add(id);
      } else {
        visit(nested);
      }
    }
  }
}
