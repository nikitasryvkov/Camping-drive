export type PublicPageBlockContent = Record<string, unknown>;

export type PublicImageSource = {
  url: string;
  width: number | null;
  height: number | null;
};

export type PublicImageSources = {
  original: PublicImageSource;
  medium?: PublicImageSource;
  thumbnail?: PublicImageSource;
};

export type PublicPageBlock = {
  id: string;
  type: string;
  position: number;
  content: PublicPageBlockContent;
  images: Record<string, PublicImageSources>;
};

export type PublicPage = {
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
  blocks: PublicPageBlock[];
};

export type PublicNewsItem = {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  coverImageSources: PublicImageSources | null;
};

export type PublicNewsArticle = PublicNewsItem & {
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
};

export type PublicNewsList = {
  data: PublicNewsItem[];
  pagination: { limit: number; offset: number; total: number };
};

export class PublicApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PublicApiError";
  }
}

export async function getPublicSiteSettings(signal?: AbortSignal): Promise<PublicSiteSettings> {
  const response = await fetch("/api/public/settings", { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new PublicApiError(response.status, "Не удалось загрузить настройки сайта");
  try {
    const body = await response.json() as { data?: PublicSiteSettings };
    if (!body.data || !Array.isArray(body.data.menu) || !Array.isArray(body.data.phones)) {
      throw new Error("Invalid public settings response");
    }
    return body.data;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(502, "Сервер вернул некорректные настройки сайта");
  }
}

export async function getPublicPage(slug: string, signal?: AbortSignal): Promise<PublicPage> {
  const response = await fetch(`/api/public/pages/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new PublicApiError(
      response.status,
      response.status === 404 ? "Страница не найдена" : "Не удалось загрузить страницу",
    );
  }

  try {
    const body = await response.json() as { data?: PublicPage };
    if (!body.data || !Array.isArray(body.data.blocks)) {
      throw new Error("Invalid public page response");
    }
    return body.data;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(502, "Сервер вернул некорректные данные");
  }
}

export async function getPublicNews(limit: number, signal?: AbortSignal): Promise<PublicNewsItem[]> {
  const result = await getPublicNewsList({ limit, offset: 0 }, signal);
  return result.data;
}

export async function getPublicNewsList(
  options: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<PublicNewsList> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 9),
    offset: String(options.offset ?? 0),
  });
  const response = await fetch(`/api/public/news?${query}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new PublicApiError(response.status, "Не удалось загрузить новости");
  try {
    const body = await response.json() as Partial<PublicNewsList>;
    if (!Array.isArray(body.data) || !body.pagination || typeof body.pagination.total !== "number") {
      throw new Error("Invalid public news response");
    }
    return body as PublicNewsList;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(502, "Сервер вернул некорректные данные");
  }
}

export async function getPublicNewsArticle(slug: string, signal?: AbortSignal): Promise<PublicNewsArticle> {
  const response = await fetch(`/api/public/news/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new PublicApiError(
      response.status,
      response.status === 404 ? "Новость не найдена" : "Не удалось загрузить новость",
    );
  }
  try {
    const body = await response.json() as { data?: PublicNewsArticle };
    if (!body.data || typeof body.data.content !== "string") throw new Error("Invalid public news article response");
    return body.data;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(502, "Сервер вернул некорректные данные");
  }
}
import type { PublicSiteSettings } from "../siteSettings";
