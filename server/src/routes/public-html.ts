import { readFile } from "node:fs/promises";

import { Router, type Response } from "express";
import type { QueryResultRow } from "pg";

import { config } from "../config.js";
import type { QueryExecutor } from "../database.js";
import { DEFAULT_SITE_SETTINGS } from "../site-settings.js";

const slugPattern = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
let templatePromise: Promise<string> | undefined;

interface PageMetaRow extends QueryResultRow {
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

interface NewsMetaRow extends PageMetaRow {
  coverImageUrl: string | null;
}

interface SiteMetaRow extends QueryResultRow {
  value: {
    siteName?: unknown;
    phones?: Array<{ href?: unknown }>;
    newsSeo?: { title?: unknown; description?: unknown };
  };
}

type SiteMetadata = {
  siteName: string;
  telephone: string;
  newsTitle: string;
  newsDescription: string;
};

type Metadata = {
  title: string;
  description: string;
  canonicalPath: string;
  type?: "website" | "article";
  image?: string;
  robots?: string;
  site: SiteMetadata;
};

export function createPublicHtmlRouter(database: QueryExecutor): Router {
  const router = Router();

  router.get("/page/:slug", async (request, response) => {
    const slug = normalizeSlug(request.params.slug ?? "");
    const result = slug
      ? await database.query<PageMetaRow>(
          `SELECT slug, title, seo_title AS "seoTitle", seo_description AS "seoDescription"
           FROM pages
           WHERE slug = $1 AND status = 'published'
           LIMIT 1`,
          [slug],
        )
      : { rows: [] };
    const page = result.rows[0];
    const site = await getSiteMetadata(database);
    if (!page) {
      await sendHtml(response, {
        title: `Страница не найдена — ${site.siteName}`,
        description: "Запрошенная страница не найдена или ещё не опубликована.",
        canonicalPath: slug ? `/${slug}` : "/404",
        robots: "noindex, nofollow",
        site,
      }, 404);
      return;
    }

    await sendHtml(response, {
      title: page.seoTitle || `${page.title} — ${site.siteName}`,
      description: page.seoDescription || `${site.siteName} — отдых на природе.`,
      canonicalPath: page.slug === "home" ? "/" : `/${page.slug}`,
      site,
    });
  });

  router.get("/news", async (request, response) => {
    const settings = await getSiteMetadata(database);
    const page = parseNewsPage(request.query.page);
    if (page > 1) {
      const result = await database.query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM news
         WHERE status = 'published' AND published_at <= now()`,
      );
      const totalPages = Math.max(1, Math.ceil(Number(result.rows[0]?.total ?? 0) / 9));
      if (page > totalPages) {
        response.redirect(302, totalPages === 1 ? "/news" : `/news?page=${totalPages}`);
        return;
      }
    }
    const suffix = page > 1 ? ` — страница ${page}` : "";
    await sendHtml(response, {
      title: `${settings.newsTitle}${suffix}`,
      description: settings.newsDescription,
      canonicalPath: page > 1 ? `/news?page=${page}` : "/news",
      site: settings,
    });
  });

  router.get("/news/:slug", async (request, response) => {
    const slug = normalizeSlug(request.params.slug ?? "");
    const result = slug
      ? await database.query<NewsMetaRow>(
          `SELECT
             news.slug,
             news.title,
             news.seo_title AS "seoTitle",
             news.seo_description AS "seoDescription",
             CASE WHEN cover.id IS NULL THEN NULL ELSE '/uploads/' || cover.storage_path END AS "coverImageUrl"
           FROM news
           LEFT JOIN images AS cover ON cover.id = news.cover_image_id
           WHERE news.slug = $1 AND news.status = 'published' AND news.published_at <= now()
           LIMIT 1`,
          [slug],
        )
      : { rows: [] };
    const article = result.rows[0];
    const site = await getSiteMetadata(database);
    if (!article) {
      await sendHtml(response, {
        title: `Новость не найдена — ${site.siteName}`,
        description: "Запрошенная новость не найдена или ещё не опубликована.",
        canonicalPath: slug ? `/news/${slug}` : "/news/404",
        robots: "noindex, nofollow",
        site,
      }, 404);
      return;
    }

    await sendHtml(response, {
      title: article.seoTitle || `${article.title} — ${site.siteName}`,
      description: article.seoDescription || `${article.title}. Новости ${site.siteName}.`,
      canonicalPath: `/news/${article.slug}`,
      type: "article",
      image: article.coverImageUrl ?? undefined,
      site,
    });
  });

  return router;
}

async function getSiteMetadata(database: QueryExecutor): Promise<SiteMetadata> {
  const result = await database.query<SiteMetaRow>(
    "SELECT value FROM site_settings WHERE key = 'site' AND is_public = true LIMIT 1",
  );
  const value = result.rows[0]?.value;
  const siteName = typeof value?.siteName === "string" ? value.siteName : DEFAULT_SITE_SETTINGS.siteName;
  const telephoneValue = value?.phones?.[0]?.href;
  const telephone = typeof telephoneValue === "string" && telephoneValue.startsWith("tel:")
    ? telephoneValue.slice(4)
    : DEFAULT_SITE_SETTINGS.phones[0]!.href.slice(4);
  return {
    siteName,
    telephone,
    newsTitle: typeof value?.newsSeo?.title === "string" ? value.newsSeo.title : DEFAULT_SITE_SETTINGS.newsSeo.title,
    newsDescription: typeof value?.newsSeo?.description === "string"
      ? value.newsSeo.description
      : DEFAULT_SITE_SETTINGS.newsSeo.description,
  };
}

function normalizeSlug(value: string): string | undefined {
  return value.length > 0 && value.length <= 200 && value === value.toLocaleLowerCase() && slugPattern.test(value)
    ? value
    : undefined;
}

async function sendHtml(response: Response, metadata: Metadata, status = 200): Promise<void> {
  const template = await loadTemplate();
  const baseUrl = config.publicSiteUrl ?? "";
  const canonical = `${baseUrl}${metadata.canonicalPath}`;
  const image = metadata.image
    ? metadata.image.startsWith("http") ? metadata.image : `${baseUrl}${metadata.image}`
    : `${baseUrl}/media/hero-day.webp`;
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeText(metadata.title)}</title>`)
    .replace(/<meta id="meta-description"[^>]*>/i, () => metaTag("meta-description", "name", "description", metadata.description))
    .replace(/<meta id="meta-robots"[^>]*>/i, () => metaTag("meta-robots", "name", "robots", metadata.robots ?? "index, follow"))
    .replace(/<meta id="og-type"[^>]*>/i, () => metaTag("og-type", "property", "og:type", metadata.type ?? "website"))
    .replace(/<meta id="og-title"[^>]*>/i, () => metaTag("og-title", "property", "og:title", metadata.title))
    .replace(/<meta id="og-description"[^>]*>/i, () => metaTag("og-description", "property", "og:description", metadata.description))
    .replace(/<meta id="og-url"[^>]*>/i, () => metaTag("og-url", "property", "og:url", canonical))
    .replace(/<meta id="og-image"[^>]*>/i, () => metaTag("og-image", "property", "og:image", image))
    .replace(/<link id="canonical-url"[^>]*>/i, () => `<link id="canonical-url" rel="canonical" href="${escapeAttribute(canonical)}" />`)
    .replace(
      /<script id="structured-data"[^>]*>[\s\S]*?<\/script>/i,
      () => structuredDataScript(metadata.site),
    );

  response.status(status);
  response.set("Cache-Control", "no-cache");
  response.set("X-Robots-Tag", metadata.robots ?? "index, follow");
  response.type("html").send(html);
}

function loadTemplate(): Promise<string> {
  if (!config.publicIndexPath) {
    throw new Error("PUBLIC_INDEX_PATH is required for server-rendered metadata");
  }
  templatePromise ??= readFile(config.publicIndexPath, "utf8");
  return templatePromise;
}

function metaTag(id: string, attribute: "name" | "property", key: string, value: string): string {
  return `<meta id="${id}" ${attribute}="${key}" content="${escapeAttribute(value)}" />`;
}

function parseNewsPage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= 111_112 ? page : 1;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function structuredDataScript(site: SiteMetadata): string {
  const serialized = JSON.stringify({
    "@context": "https://schema.org",
    "@type": ["Campground", "LocalBusiness"],
    name: site.siteName,
    telephone: site.telephone,
    geo: {
      "@type": "GeoCoordinates",
      latitude: 55.988505,
      longitude: 38.980568,
    },
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<script id="structured-data" type="application/ld+json">${serialized}</script>`;
}
