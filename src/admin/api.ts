export type Administrator = {
  id: string;
  login: string;
  role: "administrator";
};

export type ImageVariant = {
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
};

export type ImageAsset = {
  id: string;
  filename: string;
  originalFilename: string;
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  variants: Record<string, ImageVariant>;
  usageCount: number;
  pageBlockUsageCount: number;
  newsUsageCount: number;
  siteSettingUsageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageList = {
  data: ImageAsset[];
  pagination: { limit: number; offset: number; total: number };
  uploadConstraints: ImageUploadConstraints;
};

export type ImageUploadConstraints = {
  maxFileBytes: number;
  maxInputPixels: number;
  supportedMimeTypes: string[];
};

export type PageStatus = "draft" | "published";

export type PageBlockContent = Record<string, unknown>;

export type PageBlock = {
  id: string;
  pageId: string;
  type: string;
  position: number;
  isVisible: boolean;
  content: PageBlockContent;
  createdAt: string;
  updatedAt: string;
};

export type PageSummary = {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EditablePage = PageSummary & {
  blocks: PageBlock[];
};

export type PageList = {
  data: PageSummary[];
  pagination: { limit: number; offset: number; total: number };
};

export type PageInput = {
  slug: string;
  title: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: PageStatus;
};

export type NewsStatus = "draft" | "published";

export type NewsItem = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImageId: string | null;
  status: NewsStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewsSummary = Pick<
  NewsItem,
  "id" | "slug" | "title" | "status" | "publishedAt" | "createdAt" | "updatedAt"
>;

export type NewsList = {
  data: NewsSummary[];
  pagination: { limit: number; offset: number; total: number };
};

export type NewsInput = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImageId: string | null;
  status: NewsStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type NewsUpdateInput = Partial<NewsInput> & {
  expectedUpdatedAt: string;
};

export type SiteSettingRecord = {
  key: "site";
  value: SiteSettingsValue;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type ErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type SessionResponse = {
  data:
    | { authenticated: false }
    | {
        authenticated: true;
        administrator: Administrator;
        expiresAt: string;
      };
};

type LoginResponse = {
  data: {
    administrator: Administrator;
    expiresAt: string;
  };
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

export async function getAdministratorSession(): Promise<Administrator | null> {
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = await readJson<SessionResponse & ErrorResponse>(response);

  if (!response.ok) {
    throw toApiError(response, body);
  }

  return body.data.authenticated ? body.data.administrator : null;
}

export async function loginAdministrator(
  login: string,
  password: string,
): Promise<Administrator> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ login, password }),
  });
  const body = await readJson<LoginResponse & ErrorResponse>(response);

  if (!response.ok) {
    throw toApiError(response, body);
  }

  return body.data.administrator;
}

export async function logoutAdministrator(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await readJson<ErrorResponse>(response);
    throw toApiError(response, body);
  }
}

export async function listImages(options: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ImageList> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 24),
    offset: String(options.offset ?? 0),
  });
  if (options.search?.trim()) {
    query.set("search", options.search.trim());
  }
  return adminJsonRequest<ImageList>(`/api/images?${query}`);
}

export async function getImage(id: string): Promise<ImageAsset> {
  const result = await adminJsonRequest<{ data: ImageAsset }>(`/api/images/${id}`);
  return result.data;
}

export async function getImagesByIds(ids: readonly string[]): Promise<ImageAsset[]> {
  if (ids.length === 0) return [];
  const images = await Promise.all([...new Set(ids)].map(loadBatchedImage));
  return images.filter((image): image is ImageAsset => image !== null);
}

const imageBatchCache = new Map<string, Promise<ImageAsset | null>>();
const pendingImageBatch = new Map<
  string,
  { resolve: (image: ImageAsset | null) => void; reject: (error: unknown) => void }
>();
let imageBatchScheduled = false;

function loadBatchedImage(id: string): Promise<ImageAsset | null> {
  const cached = imageBatchCache.get(id);
  if (cached) return cached;

  let resolvePromise!: (image: ImageAsset | null) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<ImageAsset | null>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  imageBatchCache.set(id, promise);
  pendingImageBatch.set(id, { resolve: resolvePromise, reject: rejectPromise });

  if (!imageBatchScheduled) {
    imageBatchScheduled = true;
    queueMicrotask(() => void flushImageBatch());
  }
  return promise;
}

async function flushImageBatch(): Promise<void> {
  imageBatchScheduled = false;
  const entries = [...pendingImageBatch.entries()].slice(0, 200);
  entries.forEach(([id]) => pendingImageBatch.delete(id));
  const ids = entries.map(([id]) => id);
  try {
    const query = new URLSearchParams({ ids: ids.join(",") });
    const result = await adminJsonRequest<{ data: ImageAsset[] }>(`/api/images/batch?${query}`);
    const imagesById = new Map(result.data.map((image) => [image.id, image]));
    entries.forEach(([id, pending]) => {
      imageBatchCache.delete(id);
      pending.resolve(imagesById.get(id) ?? null);
    });
  } catch (error) {
    entries.forEach(([id, pending]) => {
      imageBatchCache.delete(id);
      pending.reject(error);
    });
  } finally {
    if (pendingImageBatch.size > 0 && !imageBatchScheduled) {
      imageBatchScheduled = true;
      queueMicrotask(() => void flushImageBatch());
    }
  }
}

export async function uploadImage(
  file: File,
  altText = "",
  signal?: AbortSignal,
): Promise<ImageAsset> {
  const formData = new FormData();
  formData.set("image", file, file.name);
  if (altText.trim()) {
    formData.set("altText", altText.trim());
  }

  const response = await fetch("/api/images", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body: formData,
    signal,
  });
  const body = await readJson<{ data: ImageAsset } & ErrorResponse>(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }
  return body.data;
}

export async function updateImageAltText(
  id: string,
  altText: string,
  expectedUpdatedAt: string,
): Promise<ImageAsset> {
  const result = await adminJsonRequest<{ data: ImageAsset }>(`/api/images/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ altText: altText.trim() || null, expectedUpdatedAt }),
  });
  return result.data;
}

export async function deleteImage(id: string, expectedUpdatedAt: string): Promise<void> {
  const query = new URLSearchParams({ expectedUpdatedAt });
  const response = await fetch(`/api/images/${id}?${query}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await readJson<ErrorResponse>(response);
    throw toApiError(response, body);
  }
}

export async function listPages(options: {
  search?: string;
  status?: PageStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<PageList> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  });
  if (options.search?.trim()) query.set("search", options.search.trim());
  if (options.status) query.set("status", options.status);
  return adminJsonRequest<PageList>(`/api/pages?${query}`);
}

export async function getPage(id: string): Promise<EditablePage> {
  const result = await adminJsonRequest<{ data: EditablePage }>(`/api/pages/${id}`);
  return result.data;
}

export async function createPage(input: PageInput): Promise<EditablePage> {
  const result = await adminJsonRequest<{ data: EditablePage }>("/api/pages", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function savePageBuilder(
  id: string,
  input: {
    slug: string;
    title: string;
    status: PageStatus;
    seoTitle: string | null;
    seoDescription: string | null;
    expectedUpdatedAt: string;
    blocks: Array<{
      id?: string;
      type: string;
      isVisible: boolean;
      content: PageBlockContent;
    }>;
  },
): Promise<EditablePage> {
  const result = await adminJsonRequest<{ data: EditablePage }>(`/api/pages/${id}/builder`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function deletePage(id: string, expectedUpdatedAt: string): Promise<void> {
  const query = new URLSearchParams({ expectedUpdatedAt });
  await adminEmptyRequest(`/api/pages/${id}?${query}`, { method: "DELETE" });
}

export async function listNews(options: {
  search?: string;
  status?: NewsStatus;
  limit?: number;
  offset?: number;
} = {}): Promise<NewsList> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  });
  if (options.search?.trim()) query.set("search", options.search.trim());
  if (options.status) query.set("status", options.status);
  return adminJsonRequest<NewsList>(`/api/news?${query}`);
}

export async function getNewsItem(id: string): Promise<NewsItem> {
  const result = await adminJsonRequest<{ data: NewsItem }>(`/api/news/${id}`);
  return result.data;
}

export async function createNewsItem(input: NewsInput): Promise<NewsItem> {
  const result = await adminJsonRequest<{ data: NewsItem }>("/api/news", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function updateNewsItem(id: string, input: NewsUpdateInput): Promise<NewsItem> {
  const result = await adminJsonRequest<{ data: NewsItem }>(`/api/news/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function deleteNewsItem(id: string, expectedUpdatedAt: string): Promise<void> {
  const query = new URLSearchParams({ expectedUpdatedAt });
  await adminEmptyRequest(`/api/news/${id}?${query}`, { method: "DELETE" });
}

export async function getSiteSettings(): Promise<SiteSettingRecord> {
  const result = await adminJsonRequest<{ data: SiteSettingRecord }>("/api/settings/site");
  return result.data;
}

export async function saveSiteSettings(value: SiteSettingsValue, expectedUpdatedAt: string | null): Promise<SiteSettingRecord> {
  const result = await adminJsonRequest<{ data: SiteSettingRecord }>("/api/settings/site", {
    method: "PUT",
    body: JSON.stringify({
      value,
      description: "Логотип, контакты, меню, подвал, кнопки связи и общие SEO-настройки сайта",
      isPublic: true,
      expectedUpdatedAt,
    }),
  });
  return result.data;
}

async function adminJsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await readJson<T & ErrorResponse>(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }
  return body;
}

async function adminEmptyRequest(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await readJson<ErrorResponse>(response);
    throw toApiError(response, body);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdminApiError(
      response.status,
      response.ok ? "Сервер вернул некорректный ответ" : `Сервер отклонил запрос (HTTP ${response.status})`,
    );
  }
}

export function toApiError(response: Response, body: ErrorResponse): AdminApiError {
  const code = body.error?.code;
  let message = "Не удалось выполнить запрос";

  if (response.status === 401 && code === "INVALID_CREDENTIALS") {
    message = "Неверный логин или пароль";
  } else if (response.status === 401) {
    message = "Сессия завершилась. Войдите снова";
  } else if (response.status === 429 && code === "TOO_MANY_LOGIN_ATTEMPTS") {
    message = "Слишком много попыток входа. Попробуйте позже";
  } else if (response.status === 429) {
    message = "Слишком много запросов. Повторите попытку позже";
  } else if (code === "IMAGE_TOO_LARGE") {
    message = "Файл превышает допустимый размер";
  } else if (response.status === 413 || code === "PAYLOAD_TOO_LARGE") {
    message = "Данные превышают допустимый размер";
  } else if (code === "IMAGE_PROCESSING_BUSY") {
    message = "Обработка изображений занята. Повторите загрузку через несколько секунд";
  } else if (code === "IMAGE_IN_USE" || code === "REFERENCE_CONFLICT") {
    message = "Изображение используется на сайте и не может быть удалено";
  } else if (code === "EDIT_CONFLICT") {
    message = "Данные уже изменены в другой вкладке. Обновите страницу и повторите правки";
  } else if (code === "VALIDATION_ERROR") {
    message = "Проверьте правильность заполнения обязательных полей и ссылок";
  } else if (response.status >= 500) {
    message = "Сервис временно недоступен";
  } else if (body.error?.message) {
    message = body.error.message;
  }

  return new AdminApiError(response.status, message, code);
}
import type { SiteSettingsValue } from "../siteSettings";
