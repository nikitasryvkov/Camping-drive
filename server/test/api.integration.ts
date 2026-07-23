import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

process.env.NODE_ENV = "test";
process.env.TRUST_PROXY_HOPS = "2";
process.env.PUBLIC_INDEX_PATH = resolve("index.html");
process.env.PUBLIC_SITE_URL = "https://camping.example.test";
const testUploadsDir = join(tmpdir(), `camping-drive-api-${randomBytes(12).toString("hex")}`);
process.env.UPLOADS_DIR = testUploadsDir;
const testToken = randomBytes(8).toString("hex");
const adminLogin = `integration-admin-${testToken}`;
const adminPassword = `Integration-${randomBytes(18).toString("base64url")}`;

const { config } = await import("../src/config.js");
if (!config.database.database.endsWith("_test")) {
  await rm(testUploadsDir, { recursive: true, force: true });
  throw new Error("Integration tests require PGDATABASE ending with _test");
}

const [{ createApp }, { database }, { runMigrations }, { hashPassword }, pageBlocksModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/database.js"),
  import("../src/migrations.js"),
  import("../src/password.js"),
  import("../src/page-blocks.js"),
]);
const { PAGE_BLOCK_TYPES, validatePageBlockContent } = pageBlocksModule;

await mkdir(testUploadsDir);

try {
  await runMigrations();
  await database.query(
    `INSERT INTO administrators (login, password_hash, role)
     VALUES ($1, $2, 'administrator')`,
    [adminLogin, await hashPassword(adminPassword)],
  );
} catch (error) {
  await database.end();
  await rm(testUploadsDir, { recursive: true, force: true });
  throw error;
}

const app = createApp();
const server = app.listen(0, "127.0.0.1");
try {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
} catch (error) {
  server.close();
  await database.end();
  await rm(testUploadsDir, { recursive: true, force: true });
  throw error;
}

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Integration test server did not expose a TCP port");
}
const baseUrl = `http://127.0.0.1:${address.port}`;
const imageOriginalFilename = `обложка-${testToken}.png`;
const newsSlug = `integration-news-${testToken}`;
const pageSlug = `integration-page-${testToken}`;
const settingKey = `contact.integration${testToken}`;
const deletedSettingKey = `deleted.integration${testToken}`;
let adminCookie: string | undefined;

try {
  const ready = await request("/api/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");

  for (const nonCanonicalPath of [
    "/api/auth/login/",
    "/api/auth/LOGIN",
    "/api/auth//login",
    "/api/auth/login%2F",
  ]) {
    const nonCanonicalLogin = await request(nonCanonicalPath, {
      method: "POST",
      body: { login: "nobody", password: "not-used" },
    });
    assert.equal(nonCanonicalLogin.status, 404);
  }

  const seededPublicHome = await request("/api/public/pages/home");
  assert.equal(seededPublicHome.status, 200);
  assert.equal(seededPublicHome.body.data.status, undefined);
  assert.equal(seededPublicHome.body.data.blocks.length, 14);
  const publicHomeHead = await fetch(`${baseUrl}/api/public/pages/home`, { method: "HEAD" });
  assert.equal(publicHomeHead.status, 204);
  assert.deepEqual(
    seededPublicHome.body.data.blocks.map((item: { position: number }) => item.position),
    Array.from({ length: 14 }, (_, index) => index),
  );
  for (const block of seededPublicHome.body.data.blocks as Array<{ type: string; content: Record<string, unknown> }>) {
    assert.ok(PAGE_BLOCK_TYPES.includes(block.type as (typeof PAGE_BLOCK_TYPES)[number]));
    validatePageBlockContent(block.type as (typeof PAGE_BLOCK_TYPES)[number], block.content);
  }
  await database.query("UPDATE pages SET status = 'draft' WHERE slug = 'home'");
  const seedHomeSql = await readFile(new URL("../migrations/006_seed_public_home_page.sql", import.meta.url), "utf8");
  await database.query(seedHomeSql);
  const upgradedExistingHome = await request("/api/public/pages/home");
  assert.equal(upgradedExistingHome.status, 404);
  const preservedDraftHome = await database.query<{ status: string; blockCount: number }>(
    `SELECT page.status, count(block.id)::integer AS "blockCount"
     FROM pages AS page
     LEFT JOIN page_blocks AS block ON block.page_id = page.id
     WHERE page.slug = 'home'
     GROUP BY page.id`,
  );
  assert.deepEqual(preservedDraftHome.rows[0], { status: "draft", blockCount: 14 });
  await database.query("UPDATE pages SET status = 'published' WHERE slug = 'home'");

  const renderedHome = await fetch(`${baseUrl}/internal/render/page/home`);
  const renderedHomeHtml = await renderedHome.text();
  assert.equal(renderedHome.status, 200);
  assert.match(renderedHome.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(renderedHomeHtml, /<link id="canonical-url" rel="canonical" href="https:\/\/camping\.example\.test\/"/);
  const structuredDataMatch = /<script id="structured-data" type="application\/ld\+json">([^<]+)<\/script>/.exec(renderedHomeHtml);
  assert.ok(structuredDataMatch);
  const structuredData = JSON.parse(structuredDataMatch[1]!) as { name: string; telephone: string };
  assert.equal(structuredData.name, "Кемпинг Драйв");
  assert.equal(structuredData.telephone, "+79858012443");

  const renderedNews = await fetch(`${baseUrl}/internal/render/news`);
  assert.equal(renderedNews.status, 200);
  assert.match(await renderedNews.text(), /href="https:\/\/camping\.example\.test\/news"/);
  const renderedNewsPage = await fetch(`${baseUrl}/internal/render/news?page=2`, {
    redirect: "manual",
  });
  assert.equal(renderedNewsPage.status, 302);
  assert.equal(renderedNewsPage.headers.get("location"), "/news");

  const renderedMissing = await fetch(`${baseUrl}/internal/render/page/missing-${testToken}`);
  assert.equal(renderedMissing.status, 404);
  assert.match(await renderedMissing.text(), /content="noindex, nofollow"/);

  const unauthenticatedLargeMutation = await request("/api/pages", {
    method: "POST",
    rawBody: JSON.stringify({ padding: "x".repeat(3 * 1024 * 1024) }),
  });
  assert.equal(unauthenticatedLargeMutation.status, 401);
  assert.equal(unauthenticatedLargeMutation.body.error.code, "AUTHENTICATION_REQUIRED");

  const publicSiteSettings = await request("/api/public/settings");
  assert.equal(publicSiteSettings.status, 200);
  assert.equal(publicSiteSettings.body.data.siteName, "Кемпинг Драйв");
  assert.equal(publicSiteSettings.body.data.logoUrl, "/logo-kemping-drive.png");
  assert.equal(publicSiteSettings.body.data.menu.length, 7);

  for (const protectedPath of ["/api/pages", "/api/news", "/api/images", "/api/settings"]) {
    const protectedBeforeLogin = await request(protectedPath);
    assert.equal(protectedBeforeLogin.status, 401);
    assert.equal(protectedBeforeLogin.body.error.code, "AUTHENTICATION_REQUIRED");
  }

  const sessionBeforeLogin = await request("/api/auth/session");
  assert.equal(sessionBeforeLogin.status, 200);
  assert.equal(sessionBeforeLogin.body.data.authenticated, false);

  const rejectedCrossSiteMutation = await request("/api/auth/logout", {
    method: "POST",
    origin: "https://untrusted.example",
    secFetchSite: "cross-site",
  });
  assert.equal(rejectedCrossSiteMutation.status, 403);
  assert.equal(rejectedCrossSiteMutation.body.error.code, "UNTRUSTED_ORIGIN");

  const rejectedSiblingMutation = await request("/api/auth/logout", {
    method: "POST",
    secFetchSite: "same-site",
  });
  assert.equal(rejectedSiblingMutation.status, 403);

  const firstClientProxyChain = "198.51.100.11, 172.20.0.4";
  const concurrentLogins = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    concurrentLogins.push(await request("/api/auth/login", {
      method: "POST",
      body: { login: `missing-${testToken}`, password: "incorrect password" },
      forwardedFor: firstClientProxyChain,
    }));
  }
  assert.deepEqual(
    concurrentLogins.map((response) => response.status).sort(),
    [401, 401, 401, 401, 401, 429, 429, 429],
  );
  assert.ok(
    concurrentLogins
      .filter((response) => response.status === 429)
      .every((response) => Number(response.headers.get("retry-after")) > 0),
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejectedLogin = await request("/api/auth/login", {
      method: "POST",
      body: { login: adminLogin, password: `${adminPassword}-wrong` },
      forwardedFor: firstClientProxyChain,
    });
    assert.equal(rejectedLogin.status, 401);
    assert.equal(rejectedLogin.body.error.code, "INVALID_CREDENTIALS");
  }

  const blockedFirstClient = await request("/api/auth/login", {
    method: "POST",
    body: { login: adminLogin, password: adminPassword },
    forwardedFor: firstClientProxyChain,
  });
  assert.equal(blockedFirstClient.status, 429);

  const blockedSecondClient = await request("/api/auth/login", {
    method: "POST",
    body: { login: adminLogin.toUpperCase(), password: adminPassword },
    forwardedFor: "198.51.100.12, 172.20.0.4",
    forwardedProto: "https",
  });
  assert.equal(blockedSecondClient.status, 429);
  await database.query("DELETE FROM administrator_login_rate_limits");

  const acceptedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { login: adminLogin.toUpperCase(), password: adminPassword },
    forwardedFor: "198.51.100.12, 172.20.0.4",
    forwardedProto: "https",
  });
  assert.equal(acceptedLogin.status, 200);
  assert.equal(acceptedLogin.body.data.administrator.login, adminLogin);
  assert.equal(acceptedLogin.body.data.administrator.role, "administrator");
  const setCookie = acceptedLogin.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Secure/i);
  adminCookie = setCookie.split(";", 1)[0];

  const activeSession = await request("/api/auth/session");
  assert.equal(activeSession.status, 200);
  assert.equal(activeSession.body.data.authenticated, true);
  assert.equal(activeSession.body.data.administrator.role, "administrator");

  const invalidImageForm = new FormData();
  invalidImageForm.set(
    "image",
    new Blob(["this is not a JPEG"], { type: "image/jpeg" }),
    "broken.jpg",
  );
  const invalidImage = await request("/api/images", {
    method: "POST",
    formData: invalidImageForm,
  });
  assert.equal(invalidImage.status, 400);
  assert.equal(invalidImage.body.error.code, "VALIDATION_ERROR");

  const oversizedImageForm = new FormData();
  oversizedImageForm.set(
    "image",
    new Blob([new Uint8Array(15 * 1024 * 1024 + 1)], { type: "image/png" }),
    "too-large.png",
  );
  const oversizedImage = await request("/api/images", {
    method: "POST",
    formData: oversizedImageForm,
  });
  assert.equal(oversizedImage.status, 413);
  assert.equal(oversizedImage.body.error.code, "IMAGE_TOO_LARGE");

  const imageSource = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 43, g: 126, b: 79 },
    },
  }).png().toBuffer();
  const imageForm = new FormData();
  imageForm.set(
    "image",
    new Blob([new Uint8Array(imageSource)], { type: "image/png" }),
    imageOriginalFilename,
  );
  imageForm.set("altText", "Тестовая обложка");
  const image = await request("/api/images", {
    method: "POST",
    formData: imageForm,
  });
  assert.equal(image.status, 201, JSON.stringify(image.body));
  assert.match(image.body.data.id, /^\d+$/);
  assert.equal(image.body.data.originalFilename, imageOriginalFilename);
  assert.equal(image.body.data.mimeType, "image/webp");
  assert.equal(image.body.data.width, 1600);
  assert.equal(image.body.data.height, 900);
  assert.equal(image.body.data.usageCount, 0);
  assert.equal(image.body.data.variants.medium.width, 1280);
  assert.equal(image.body.data.variants.thumbnail.width, 480);
  assert.match(image.body.data.url, /^\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/original\.webp$/);
  const batchedImages = await request(`/api/images/batch?ids=${image.body.data.id},${image.body.data.id}`);
  assert.equal(batchedImages.status, 200);
  assert.equal(batchedImages.body.data.length, 1);
  assert.equal(batchedImages.body.data[0].id, image.body.data.id);
  const storedImageUrls = [
    image.body.data.url,
    image.body.data.variants.medium.url,
    image.body.data.variants.thumbnail.url,
  ];

  const imageListAfterUpload = await request("/api/images");
  assert.equal(imageListAfterUpload.status, 200);
  assert.equal(imageListAfterUpload.body.uploadConstraints.maxFileBytes, 15 * 1024 * 1024);
  assert.deepEqual(imageListAfterUpload.body.uploadConstraints.supportedMimeTypes, [
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

  const storedImageResponse = await fetch(`${baseUrl}${image.body.data.url}`);
  assert.equal(storedImageResponse.status, 200);
  assert.match(storedImageResponse.headers.get("content-type") ?? "", /^image\/webp/);
  assert.ok((await storedImageResponse.arrayBuffer()).byteLength > 0);

  const updatedImage = await request(`/api/images/${image.body.data.id}`, {
    method: "PATCH",
    body: {
      altText: "Обновлённая тестовая обложка",
      expectedUpdatedAt: image.body.data.updatedAt,
    },
  });
  assert.equal(updatedImage.status, 200);
  assert.equal(updatedImage.body.data.altText, "Обновлённая тестовая обложка");
  const staleImageUpdate = await request(`/api/images/${image.body.data.id}`, {
    method: "PATCH",
    body: {
      altText: "Устаревшее описание",
      expectedUpdatedAt: image.body.data.updatedAt,
    },
  });
  assert.equal(staleImageUpdate.status, 409);
  assert.equal(staleImageUpdate.body.error.code, "EDIT_CONFLICT");

  const news = await request("/api/news", {
    method: "POST",
    body: {
      slug: newsSlug,
      title: "Интеграционная новость",
      excerpt: "Проверка API",
      content: "<p>Содержимое</p>",
      coverImageId: image.body.data.id,
      status: "published",
    },
  });
  assert.equal(news.status, 201);
  assert.ok(news.body.data.publishedAt);
  const administrativeNewsList = await request("/api/news?limit=100");
  const administrativeNewsSummary = administrativeNewsList.body.data.find(
    (item: Record<string, unknown>) => item.slug === newsSlug,
  );
  assert.ok(administrativeNewsSummary);
  assert.equal(Object.hasOwn(administrativeNewsSummary, "content"), false);
  const publicNews = await request("/api/public/news?limit=1");
  assert.equal(publicNews.status, 200);
  assert.equal(publicNews.body.data.length, 1);
  assert.equal(publicNews.body.data[0].slug, newsSlug);
  assert.equal(publicNews.body.data[0].status, undefined);

  const updatedNews = await request(`/api/news/${news.body.data.id}`, {
    method: "PATCH",
    body: { excerpt: "Обновлённый анонс", expectedUpdatedAt: news.body.data.updatedAt },
  });
  assert.equal(updatedNews.status, 200);
  assert.equal(updatedNews.body.data.excerpt, "Обновлённый анонс");

  const pageBody = {
    slug: pageSlug,
    title: "Интеграционная страница",
    status: "draft",
    seoTitle: "SEO title",
  };
  const page = await request("/api/pages", { method: "POST", body: pageBody });
  assert.equal(page.status, 201);
  assert.equal((await request(`/api/public/pages/${pageSlug}`)).status, 404);
  for (const reservedSlug of ["admin", "news"]) {
    const reservedPage = await request("/api/pages", {
      method: "POST",
      body: { ...pageBody, slug: reservedSlug, title: "Reserved route" },
    });
    assert.equal(reservedPage.status, 400);
  }

  const block = await request(`/api/pages/${page.body.data.id}/blocks`, {
    method: "POST",
    body: {
      expectedUpdatedAt: page.body.data.updatedAt,
      type: "hero",
      isVisible: true,
      content: {
        title: "Добро пожаловать",
        backgroundImageId: image.body.data.id,
        backgroundImageUrl: image.body.data.url,
        backgroundImageAlt: "Обложка",
      },
    },
  });
  assert.equal(block.status, 201);
  assert.equal(block.body.data.position, 0);

  const secondBlock = await request(`/api/pages/${page.body.data.id}/blocks`, {
    method: "POST",
    body: {
      expectedUpdatedAt: block.body.pageUpdatedAt,
      type: "text",
      isVisible: true,
      content: { title: "Второй блок", body: "Текст" },
    },
  });
  assert.equal(secondBlock.status, 201);
  assert.equal(secondBlock.body.data.position, 1);

  const reorderedBlocks = await request(`/api/pages/${page.body.data.id}/blocks/reorder`, {
    method: "PUT",
    body: {
      blockIds: [secondBlock.body.data.id, block.body.data.id],
      expectedUpdatedAt: secondBlock.body.pageUpdatedAt,
    },
  });
  assert.equal(reorderedBlocks.status, 200);
  assert.deepEqual(
    reorderedBlocks.body.data.map((item: { id: string; position: number }) => [item.id, item.position]),
    [[secondBlock.body.data.id, 0], [block.body.data.id, 1]],
  );

  const invalidBlockOrder = await request(`/api/pages/${page.body.data.id}/blocks/reorder`, {
    method: "PUT",
    body: {
      blockIds: [block.body.data.id],
      expectedUpdatedAt: reorderedBlocks.body.pageUpdatedAt,
    },
  });
  assert.equal(invalidBlockOrder.status, 400);

  const pageBeforeBuilderSave = await request(`/api/pages/${page.body.data.id}`);
  const updatedPage = await request(`/api/pages/${page.body.data.id}/builder`, {
    method: "PUT",
    body: {
      slug: pageSlug,
      title: "Интеграционная страница",
      status: "published",
      seoTitle: "SEO title",
      seoDescription: null,
      expectedUpdatedAt: pageBeforeBuilderSave.body.data.updatedAt,
      blocks: [
        { type: "text", isVisible: true, content: { title: "Новый блок 1", body: "" } },
        { type: "text", isVisible: true, content: { title: "Новый блок 2", body: "" } },
        ...reorderedBlocks.body.data.map((item: {
          id: string;
          type: string;
          isVisible: boolean;
          content: Record<string, unknown>;
        }) => ({ id: item.id, type: item.type, isVisible: item.isVisible, content: item.content })),
      ],
    },
  });
  assert.equal(updatedPage.status, 200);
  assert.ok(updatedPage.body.data.publishedAt);
  assert.equal(updatedPage.body.data.blocks.length, 4);
  assert.deepEqual(updatedPage.body.data.blocks.map((item: { position: number }) => item.position), [0, 1, 2, 3]);

  const staleBuilderSave = await request(`/api/pages/${page.body.data.id}/builder`, {
    method: "PUT",
    body: {
      slug: pageSlug,
      title: "Устаревшее изменение",
      status: "published",
      seoTitle: null,
      seoDescription: null,
      expectedUpdatedAt: pageBeforeBuilderSave.body.data.updatedAt,
      blocks: updatedPage.body.data.blocks.map((item: {
        id: string;
        type: string;
        isVisible: boolean;
        content: Record<string, unknown>;
      }) => ({ id: item.id, type: item.type, isVisible: item.isVisible, content: item.content })),
    },
  });
  assert.equal(staleBuilderSave.status, 409);
  assert.equal(staleBuilderSave.body.error.code, "EDIT_CONFLICT");

  const hiddenSecondBlock = await request(
    `/api/pages/${page.body.data.id}/blocks/${secondBlock.body.data.id}`,
    {
      method: "PATCH",
      body: { isVisible: false, expectedUpdatedAt: updatedPage.body.data.updatedAt },
    },
  );
  assert.equal(hiddenSecondBlock.status, 200);
  const publicPage = await request(`/api/public/pages/${pageSlug}`);
  assert.equal(publicPage.status, 200);
  assert.deepEqual(
    publicPage.body.data.blocks.map((item: { id: string }) => item.id),
    updatedPage.body.data.blocks
      .filter((item: { id: string }) => item.id !== secondBlock.body.data.id)
      .map((item: { id: string }) => item.id),
  );

  const invalidBlockType = await request(`/api/pages/${page.body.data.id}/blocks`, {
    method: "POST",
    body: { type: "unsupported", content: {} },
  });
  assert.equal(invalidBlockType.status, 400);

  const invalidReview = await request(`/api/pages/${page.body.data.id}/blocks`, {
    method: "POST",
    body: { type: "reviews", content: { items: [{ name: "Гость", text: "Отзыв", rating: 999 }] } },
  });
  assert.equal(invalidReview.status, 400);

  const prototypeFieldBlock = await request(`/api/pages/${page.body.data.id}/blocks`, {
    method: "POST",
    rawBody: '{"type":"text","content":{"toString":[]}}',
  });
  assert.equal(prototypeFieldBlock.status, 400);

  const setting = await request(`/api/settings/${settingKey}`, {
    method: "PUT",
    body: {
      value: { phone: "+7 900 000-00-00", links: ["https://example.test"] },
      description: "Контакты",
      isPublic: true,
      expectedUpdatedAt: null,
    },
  });
  assert.equal(setting.status, 200);
  assert.equal(setting.body.data.key, settingKey);
  const settingsList = await request("/api/settings?limit=100");
  const settingSummary = settingsList.body.data.find(
    (item: Record<string, unknown>) => item.key === settingKey,
  );
  assert.ok(settingSummary);
  assert.equal(Object.hasOwn(settingSummary, "value"), false);

  const updatedSetting = await request(`/api/settings/${settingKey}`, {
    method: "PATCH",
    body: {
      description: "Обновлённые контакты",
      expectedUpdatedAt: setting.body.data.updatedAt,
    },
  });
  assert.equal(updatedSetting.status, 200);
  assert.equal(updatedSetting.body.data.description, "Обновлённые контакты");
  const staleSetting = await request(`/api/settings/${settingKey}`, {
    method: "PATCH",
    body: {
      description: "Устаревшие контакты",
      expectedUpdatedAt: setting.body.data.updatedAt,
    },
  });
  assert.equal(staleSetting.status, 409);
  assert.equal(staleSetting.body.error.code, "EDIT_CONFLICT");
  const duplicateSettingCreate = await request(`/api/settings/${settingKey}`, {
    method: "PUT",
    body: {
      value: { replacement: true },
      expectedUpdatedAt: null,
    },
  });
  assert.equal(duplicateSettingCreate.status, 409);
  assert.equal(duplicateSettingCreate.body.error.code, "EDIT_CONFLICT");

  const settingBeforeConcurrentDelete = await request(`/api/settings/${deletedSettingKey}`, {
    method: "PUT",
    body: {
      value: { retained: false },
      expectedUpdatedAt: null,
    },
  });
  assert.equal(settingBeforeConcurrentDelete.status, 200);
  assert.equal(
    (await request(`/api/settings/${deletedSettingKey}?${new URLSearchParams({
      expectedUpdatedAt: settingBeforeConcurrentDelete.body.data.updatedAt,
    })}`, { method: "DELETE" })).status,
    204,
  );
  const staleSettingReplacement = await request(`/api/settings/${deletedSettingKey}`, {
    method: "PUT",
    body: {
      value: { retained: true },
      expectedUpdatedAt: settingBeforeConcurrentDelete.body.data.updatedAt,
    },
  });
  assert.equal(staleSettingReplacement.status, 404);
  assert.equal(staleSettingReplacement.body.error.code, "NOT_FOUND");
  assert.equal((await request(`/api/settings/${deletedSettingKey}`)).status, 404);

  const originalSiteSetting = await request("/api/settings/site");
  assert.equal(originalSiteSetting.status, 200);
  const changedSiteSetting = await request("/api/settings/site", {
    method: "PUT",
    body: {
      value: { ...originalSiteSetting.body.data.value, siteName: `Кемпинг ${testToken}` },
      description: originalSiteSetting.body.data.description,
      isPublic: true,
      expectedUpdatedAt: originalSiteSetting.body.data.updatedAt,
    },
  });
  assert.equal(changedSiteSetting.status, 200);
  const staleSiteSetting = await request("/api/settings/site", {
    method: "PUT",
    body: {
      value: originalSiteSetting.body.data.value,
      description: originalSiteSetting.body.data.description,
      isPublic: true,
      expectedUpdatedAt: originalSiteSetting.body.data.updatedAt,
    },
  });
  assert.equal(staleSiteSetting.status, 409);
  assert.equal(staleSiteSetting.body.error.code, "EDIT_CONFLICT");
  const restoredSiteSetting = await request("/api/settings/site", {
    method: "PUT",
    body: {
      value: originalSiteSetting.body.data.value,
      description: originalSiteSetting.body.data.description,
      isPublic: true,
      expectedUpdatedAt: changedSiteSetting.body.data.updatedAt,
    },
  });
  assert.equal(restoredSiteSetting.status, 200);

  const invalidSiteSetting = await request("/api/settings/site", {
    method: "PATCH",
    body: { value: {} },
  });
  assert.equal(invalidSiteSetting.status, 400);
  assert.equal(invalidSiteSetting.body.error.code, "VALIDATION_ERROR");

  const pageDetail = await request(`/api/pages/slug/${pageSlug}`);
  assert.equal(pageDetail.status, 200);
  assert.equal(pageDetail.body.data.blocks.length, 4);
  assert.equal(pageDetail.body.data.blocks[2].id, secondBlock.body.data.id);

  const pageList = await request(`/api/pages?status=published&search=${testToken}&limit=10&offset=0`);
  assert.equal(pageList.status, 200);
  assert.equal(pageList.body.pagination.total, 1);

  const duplicatePage = await request("/api/pages", { method: "POST", body: pageBody });
  assert.equal(duplicatePage.status, 409);
  assert.equal(duplicatePage.body.error.code, "CONFLICT");

  const invalidPage = await request(`/api/pages/${page.body.data.id}`, {
    method: "PATCH",
    body: { unknown: true },
  });
  assert.equal(invalidPage.status, 400);
  assert.equal(invalidPage.body.error.code, "VALIDATION_ERROR");

  const invalidDate = await request(`/api/pages/${page.body.data.id}`, {
    method: "PATCH",
    body: { publishedAt: "2026-02-30T00:00:00Z" },
  });
  assert.equal(invalidDate.status, 400);

  const oversizedId = await request("/api/pages/9223372036854775808");
  assert.equal(oversizedId.status, 400);

  const unsafeJsonNumber = await request(`/api/settings/unsafe.number${testToken}`, {
    method: "PUT",
    rawBody: '{"value":1.0000000000000001}',
  });
  assert.equal(unsafeJsonNumber.status, 400);

  const unsafeUtf16JsonNumber = await request(`/api/settings/unsafe.utf16${testToken}`, {
    method: "PUT",
    rawBody: Buffer.from('{"value":1.0000000000000001}', "utf16le"),
    contentType: "application/json; charset=utf-16le",
  });
  assert.equal(unsafeUtf16JsonNumber.status, 400);

  const unsupportedCharset = await request("/api/pages", {
    method: "POST",
    body: {},
    contentType: "application/json; charset=unsupported",
  });
  assert.equal(unsupportedCharset.status, 415);
  assert.equal(unsupportedCharset.body.error.code, "UNSUPPORTED_MEDIA_TYPE");

  const invalidEncodedPath = await request("/api/pages/%ZZ");
  assert.equal(invalidEncodedPath.status, 404);
  assert.equal(invalidEncodedPath.body.error.code, "NOT_FOUND");

  const referencedImageDelete = await request(`/api/images/${image.body.data.id}?${new URLSearchParams({
    expectedUpdatedAt: updatedImage.body.data.updatedAt,
  })}`, {
    method: "DELETE",
  });
  assert.equal(referencedImageDelete.status, 409);
  assert.equal(referencedImageDelete.body.error.code, "IMAGE_IN_USE");

  const blockWithoutImage = await request(
    `/api/pages/${page.body.data.id}/blocks/${block.body.data.id}`,
    {
      method: "PATCH",
      body: {
        content: { title: "Без изображения" },
        expectedUpdatedAt: hiddenSecondBlock.body.pageUpdatedAt,
      },
    },
  );
  assert.equal(blockWithoutImage.status, 200);

  const newsReferencedImageDelete = await request(`/api/images/${image.body.data.id}?${new URLSearchParams({
    expectedUpdatedAt: updatedImage.body.data.updatedAt,
  })}`, {
    method: "DELETE",
  });
  assert.equal(newsReferencedImageDelete.status, 409);
  assert.equal(newsReferencedImageDelete.body.error.code, "IMAGE_IN_USE");

  const newsWithoutImage = await request(`/api/news/${news.body.data.id}`, {
    method: "PATCH",
    body: { coverImageId: null, expectedUpdatedAt: updatedNews.body.data.updatedAt },
  });
  assert.equal(newsWithoutImage.status, 200);
  assert.equal(newsWithoutImage.body.data.coverImageId, null);

  const deleteImage = await request(`/api/images/${image.body.data.id}?${new URLSearchParams({
    expectedUpdatedAt: updatedImage.body.data.updatedAt,
  })}`, { method: "DELETE" });
  assert.equal(deleteImage.status, 204);
  for (const storedUrl of storedImageUrls) {
    assert.equal((await fetch(`${baseUrl}${storedUrl}`)).status, 404);
  }
  const deletionQueue = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM image_deletion_queue",
  );
  assert.equal(deletionQueue.rows[0]!.count, "0");
  const newsAfterImageDelete = await request(`/api/news/${news.body.data.id}`);
  assert.equal(newsAfterImageDelete.body.data.coverImageId, null);

  const deleteBlock = await request(
    `/api/pages/${page.body.data.id}/blocks/${block.body.data.id}?${new URLSearchParams({
      expectedUpdatedAt: blockWithoutImage.body.pageUpdatedAt,
    })}`,
    { method: "DELETE" },
  );
  assert.equal(deleteBlock.status, 204);
  assert.equal(
    (await request(`/api/pages/${page.body.data.id}/blocks/${block.body.data.id}`)).status,
    404,
  );
  const deleteSecondBlock = await request(
    `/api/pages/${page.body.data.id}/blocks/${secondBlock.body.data.id}?${new URLSearchParams({
      expectedUpdatedAt: deleteBlock.headers.get("x-page-updated-at")!,
    })}`,
    { method: "DELETE" },
  );
  assert.equal(deleteSecondBlock.status, 204);

  assert.equal(
    (await request(`/api/news/${news.body.data.id}?${new URLSearchParams({
      expectedUpdatedAt: newsWithoutImage.body.data.updatedAt,
    })}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal(
    (await request(`/api/settings/${settingKey}?${new URLSearchParams({
      expectedUpdatedAt: updatedSetting.body.data.updatedAt,
    })}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal(
    (await request(`/api/pages/${page.body.data.id}?${new URLSearchParams({
      expectedUpdatedAt: deleteSecondBlock.headers.get("x-page-updated-at")!,
    })}`, { method: "DELETE" })).status,
    204,
  );

  const tablesResult = await database.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const tables = tablesResult.rows.map((row) => row.tablename);
  assert.deepEqual(tables, [
    "administrator_login_rate_limits",
    "administrator_sessions",
    "administrators",
    "image_deletion_queue",
    "images",
    "news",
    "page_block_images",
    "page_blocks",
    "pages",
    "schema_migrations",
    "site_setting_images",
    "site_settings",
  ]);

  const logout = await request("/api/auth/logout", { method: "POST" });
  assert.equal(logout.status, 204);
  assert.equal((await request("/api/images")).status, 401);
  const sessionAfterLogout = await request("/api/auth/session");
  assert.equal(sessionAfterLogout.body.data.authenticated, false);

  console.log(
    JSON.stringify({
      status: "passed",
      pageId: page.body.data.id,
      blockId: block.body.data.id,
      newsId: news.body.data.id,
      settingKey: setting.body.data.key,
      tables,
    }),
  );
} finally {
  for (const [sql, values] of [
    ["DELETE FROM pages WHERE slug = $1", [pageSlug]],
    ["DELETE FROM news WHERE slug = $1", [newsSlug]],
    [
      "DELETE FROM site_settings WHERE key IN ($1, $2, $3, $4)",
      [settingKey, deletedSettingKey, `unsafe.number${testToken}`, `unsafe.utf16${testToken}`],
    ],
    ["DELETE FROM images WHERE original_filename = $1", [imageOriginalFilename]],
    ["DELETE FROM administrators WHERE login = $1", [adminLogin]],
  ] as const) {
    try {
      await database.query(sql, [...values]);
    } catch (cleanupError) {
      console.error("Integration test cleanup failed", cleanupError);
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } finally {
    await database.end();
    await rm(testUploadsDir, { recursive: true, force: true });
  }
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: string | Uint8Array;
    formData?: FormData;
    contentType?: string;
    forwardedFor?: string;
    forwardedProto?: string;
    origin?: string;
    secFetchSite?: string;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers();
  if ((options.body !== undefined || options.rawBody !== undefined) && !options.formData) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (adminCookie) {
    headers.set("cookie", adminCookie);
  }
  if (options.forwardedFor) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }
  if (options.forwardedProto) {
    headers.set("x-forwarded-proto", options.forwardedProto);
  }
  if (options.origin) {
    headers.set("origin", options.origin);
  }
  if (options.secFetchSite) {
    headers.set("sec-fetch-site", options.secFetchSite);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.formData ??
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}
