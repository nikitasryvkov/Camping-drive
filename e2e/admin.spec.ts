import { expect, test } from "@playwright/test";

import { BLOCK_DEFINITIONS } from "../src/admin/pageBlocks";
import { loginAsAdministrator, uniqueSuffix } from "./helpers";

test.describe.serial("этап 9: административные сценарии", () => {
  test("защищает админку и завершает сессию при выходе", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "Вход в админ-панель" })).toBeVisible();

    await loginAsAdministrator(page);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);

    for (const protectedPath of ["/admin", "/admin/pages", "/admin/news", "/admin/settings"]) {
      await page.goto(protectedPath);
      await expect(page).toHaveURL(/\/admin\/login$/);
      await expect(page.getByRole("heading", { name: "Вход в админ-панель" })).toBeVisible();
    }
  });

  test("загружает и удаляет изображение", async ({ page }) => {
    const suffix = uniqueSuffix();
    const filename = `stage9-${suffix}.png`;
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    await loginAsAdministrator(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "image/png",
      buffer: onePixelPng,
    });

    const imageCard = page.locator(".admin-media-card").filter({ hasText: filename });
    await expect(imageCard).toBeVisible();
    await expect(imageCard).toContainText("Не используется");

    page.once("dialog", (dialog) => dialog.accept());
    await imageCard.getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("status")).toContainText("Изображение удалено");
    await expect(imageCard).toHaveCount(0);
  });

  test("создаёт страницу со всеми типами блоков, меняет порядок и публикует", async ({ browser, page }) => {
    const suffix = uniqueSuffix();
    const title = `Страница этапа 9 ${suffix}`;
    const slug = `stage9-page-${suffix}`;
    const galleryFilename = `stage9-gallery-${suffix}.png`;
    const galleryCaption = `Подпись галереи ${suffix}`;
    const routeAddress = `Тестовый адрес ${suffix}`;
    const routeButtonLabel = `Открыть маршрут ${suffix}`;
    const routeButtonUrl = `https://example.test/route/${suffix}`;
    const latestNewsTitle = `Новость для блока ${suffix}`;

    await loginAsAdministrator(page);
    const imageUpload = await page.request.post("/api/images", {
      multipart: {
        image: {
          name: galleryFilename,
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        },
        altText: "Тестовая фотография галереи",
      },
    });
    expect(imageUpload.ok()).toBeTruthy();

    await page.goto("/admin/pages/new");
    await page.getByLabel("Название страницы").fill(title);
    await page.getByLabel("URL страницы").fill(slug);
    await page.getByRole("button", { name: "Создать и открыть" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/\d+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    const library = page.locator(".admin-block-library");
    for (const definition of BLOCK_DEFINITIONS) {
      await library.getByRole("button", { name: new RegExp(`^${escapeRegExp(definition.label)}`) }).click();
    }

    const blockCards = page.locator(".admin-block-card");
    await expect(blockCards).toHaveCount(BLOCK_DEFINITIONS.length);

    const galleryCard = blockCards.filter({ hasText: "Галерея" });
    await galleryCard.locator(".admin-block-title").click();
    await galleryCard.getByRole("button", { name: "Выбрать из медиатеки" }).click();
    const imageDialog = page.getByRole("dialog", { name: "Выбор изображения" });
    const galleryImageCard = imageDialog.locator(".admin-media-card").filter({ hasText: galleryFilename });
    await galleryImageCard.getByRole("button", { name: "Выбрать" }).click();
    await galleryCard.getByLabel("Подпись").fill(galleryCaption);

    const routeCard = blockCards.filter({ hasText: "Маршрут и карта" });
    await routeCard.locator(".admin-block-title").click();
    await routeCard.getByLabel("Адрес", { exact: true }).fill(routeAddress);
    await routeCard.getByLabel("Текст кнопки").fill(routeButtonLabel);
    await routeCard.getByLabel("Ссылка кнопки").fill(routeButtonUrl);

    await expect(blockCards.nth(0)).toContainText(BLOCK_DEFINITIONS[0]!.label);
    await expect(blockCards.nth(1)).toContainText(BLOCK_DEFINITIONS[1]!.label);

    await blockCards.nth(1).getByRole("button", { name: "Поднять блок" }).click();
    await expect(blockCards.nth(0)).toContainText(BLOCK_DEFINITIONS[1]!.label);
    await expect(blockCards.nth(1)).toContainText(BLOCK_DEFINITIONS[0]!.label);

    await blockCards.nth(2).locator(".admin-block-drag").dragTo(blockCards.nth(0));
    await expect(blockCards.nth(0)).toContainText(BLOCK_DEFINITIONS[2]!.label);

    await page.getByRole("button", { name: "Опубликовать" }).click();
    await expect(page.getByRole("status")).toContainText("Страница опубликована");

    const latestNews = await page.request.post("/api/news", {
      data: {
        slug: `stage9-block-news-${suffix}`,
        title: latestNewsTitle,
        excerpt: "Проверка успешного состояния блока последних новостей.",
        content: "Опубликованная новость для проверки блока.",
        coverImageId: null,
        status: "published",
      },
    });
    expect(latestNews.ok()).toBeTruthy();

    const origin = new URL(page.url()).origin;
    const publicContext = await browser.newContext();
    try {
      const publicResponse = await publicContext.request.get(`${origin}/api/public/pages/${slug}`);
      expect(publicResponse.ok()).toBeTruthy();
      const publicPayload = await publicResponse.json() as {
        data: { blocks: Array<{ type: string; position: number }> };
      };
      const expectedTypes = BLOCK_DEFINITIONS.map((definition) => definition.type);
      [expectedTypes[0], expectedTypes[1]] = [expectedTypes[1]!, expectedTypes[0]!];
      const [draggedType] = expectedTypes.splice(2, 1);
      expectedTypes.unshift(draggedType!);
      expect(publicPayload.data.blocks.map((block) => block.type)).toEqual(expectedTypes);
      expect(publicPayload.data.blocks.map((block) => block.position)).toEqual(
        expectedTypes.map((_, index) => index),
      );

      const publicPage = await publicContext.newPage();
      await publicPage.goto(`${origin}/${slug}`);
      await expect(publicPage.locator("main > section, main > div")).toHaveCount(BLOCK_DEFINITIONS.length);
      await expect(publicPage.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(publicPage.getByText(galleryCaption)).toBeVisible();
      await expect(publicPage.getByText(routeAddress).first()).toBeVisible();
      await expect(publicPage.getByRole("link", { name: routeButtonLabel })).toHaveAttribute("href", routeButtonUrl);
      await expect(publicPage.getByRole("heading", { name: latestNewsTitle })).toBeVisible();
      for (const characteristicText of [
        "Новый взгляд на кемпинг",
        "Введите текст раздела.",
        "Опишите преимущество или формат отдыха.",
        "Выберите свой формат",
        "Всё для комфортного отдыха",
        "Три шага до отдыха",
        "24/7",
        "Имя гостя",
        "Первый вопрос",
        "Забронируйте отдых",
        "Своя палатка",
      ]) {
        await expect(publicPage.getByText(characteristicText, { exact: true }).first()).toBeVisible();
      }
    } finally {
      await publicContext.close();
    }
  });

  test("создаёт и публикует новость", async ({ browser, page }) => {
    const suffix = uniqueSuffix();
    const title = `Новость этапа 9 ${suffix}`;
    const slug = `stage9-news-${suffix}`;

    await loginAsAdministrator(page);
    await page.goto("/admin/news/new");
    await page.getByLabel("Заголовок", { exact: true }).fill(title);
    await page.getByLabel("URL новости").fill(slug);
    await page.getByLabel("Анонс").fill("Проверка публикации новости в сквозном тесте.");
    await page.getByLabel("Текст новости").fill("Полный текст новости для этапа 9.");
    await page.getByRole("button", { name: "Опубликовать" }).click();

    await expect(page).toHaveURL(/\/admin\/news\/\d+$/);
    await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

    const origin = new URL(page.url()).origin;
    const publicContext = await browser.newContext();
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(`${origin}/news/${slug}`);
      await expect(publicPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(publicPage.getByText("Полный текст новости для этапа 9.")).toBeVisible();
    } finally {
      await publicContext.close();
    }
  });

  test("публикует название сайта и новый пункт меню", async ({ browser, page }) => {
    const suffix = uniqueSuffix();
    const siteName = `Кемпинг Драйв ${suffix}`;
    const menuLabel = `Этап 9 ${suffix}`;
    const menuHref = `/stage9-menu-${suffix}`;
    const logoFilename = `stage9-logo-${suffix}.png`;
    const address = `Адрес настроек ${suffix}`;
    const routeUrl = `https://example.test/settings-route/${suffix}`;
    const phoneDisplay = `+7 (900) ${suffix.slice(-3)}-00-00`;
    const phoneHref = `tel:+7900${suffix.replace(/\D/g, "").slice(-7).padStart(7, "0")}`;
    const contactLabel = `Контакт ${suffix}`;
    const contactHref = `https://example.test/contact/${suffix}`;
    const footerDescription = `Описание подвала ${suffix}`;
    const footerLegalText = `Служебная строка ${suffix}`;
    const floatingLabel = `Связь ${suffix.slice(-6)}`;
    const newsSeoTitle = `SEO новостей ${suffix}`;
    const newsSeoDescription = `Описание SEO новостей ${suffix}`;

    await loginAsAdministrator(page);
    const logoUpload = await page.request.post("/api/images", {
      multipart: {
        image: {
          name: logoFilename,
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        },
        altText: "Тестовый логотип",
      },
    });
    expect(logoUpload.ok()).toBeTruthy();

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Настройки сайта" })).toBeVisible();
    const brandCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Бренд и адрес" }),
    });
    await brandCard.getByLabel("Название сайта").fill(siteName);
    await brandCard.getByLabel("Адрес", { exact: true }).fill(address);
    await brandCard.getByLabel("Ссылка на маршрут").fill(routeUrl);
    await brandCard.getByRole("button", { name: "Выбрать из медиатеки" }).click();
    const logoDialog = page.getByRole("dialog", { name: "Выбор изображения" });
    await logoDialog.locator(".admin-media-card").filter({ hasText: logoFilename }).getByRole("button", { name: "Выбрать" }).click();

    const phonesCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Телефоны" }),
    });
    await phonesCard.getByLabel("Отображаемый номер").first().fill(phoneDisplay);
    await phonesCard.getByLabel("Ссылка для звонка").first().fill(phoneHref);

    const menuCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Основное меню" }),
    });
    await menuCard.getByRole("button", { name: "Добавить пункт меню" }).click();
    const menuRows = menuCard.locator(".admin-link-row");
    const lastMenuRow = menuRows.last();
    await lastMenuRow.getByLabel("Название").fill(menuLabel);
    await lastMenuRow.getByLabel("Ссылка").fill(menuHref);

    const contactsCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Ссылки в контактах" }),
    });
    await contactsCard.getByRole("button", { name: "Добавить ссылку" }).click();
    const lastContactRow = contactsCard.locator(".admin-link-row").last();
    await lastContactRow.getByLabel("Название").fill(contactLabel);
    await lastContactRow.getByLabel("Ссылка").fill(contactHref);

    const footerCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Подвал" }),
    });
    await footerCard.locator("textarea").first().fill(footerDescription);
    await footerCard.locator("input").first().fill(footerLegalText);

    const floatingCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "Плавающие кнопки связи" }),
    });
    await floatingCard.getByLabel("Текст", { exact: true }).first().fill(floatingLabel);

    const newsSeoCard = page.locator(".admin-settings-card").filter({
      has: page.getByRole("heading", { name: "SEO новостей" }),
    });
    await newsSeoCard.getByLabel("SEO-заголовок списка новостей").fill(newsSeoTitle);
    await newsSeoCard.getByLabel("SEO-описание списка новостей").fill(newsSeoDescription);

    await page.getByRole("button", { name: "Сохранить настройки" }).click();
    await expect(page.getByRole("status")).toContainText("Настройки опубликованы на сайте");

    const origin = new URL(page.url()).origin;
    const publicContext = await browser.newContext();
    try {
      const publicResponse = await publicContext.request.get(`${origin}/api/public/settings`);
      expect(publicResponse.ok()).toBeTruthy();
      const publicPayload = await publicResponse.json() as {
        data: {
          siteName: string;
          logoUrl: string;
          address: string;
          routeUrl: string;
          phones: Array<{ display: string; href: string }>;
          menu: Array<{ label: string; href: string }>;
          contactLinks: Array<{ label: string; href: string }>;
          footer: { description: string; legalText: string };
          floatingActions: Array<{ label: string }>;
          newsSeo: { title: string; description: string };
        };
      };
      expect(publicPayload.data.siteName).toBe(siteName);
      expect(publicPayload.data.logoUrl).toMatch(/^\/uploads\//);
      expect(publicPayload.data.address).toBe(address);
      expect(publicPayload.data.routeUrl).toBe(routeUrl);
      expect(publicPayload.data.phones[0]).toMatchObject({ display: phoneDisplay, href: phoneHref });
      expect(publicPayload.data.menu).toContainEqual({ label: menuLabel, href: menuHref });
      expect(publicPayload.data.contactLinks).toContainEqual({ label: contactLabel, href: contactHref });
      expect(publicPayload.data.footer).toMatchObject({ description: footerDescription, legalText: footerLegalText });
      expect(publicPayload.data.floatingActions[0]).toMatchObject({ label: floatingLabel });
      expect(publicPayload.data.newsSeo).toEqual({ title: newsSeoTitle, description: newsSeoDescription });

      const publicPage = await publicContext.newPage();
      await publicPage.goto(origin);
      const primaryNavigation = publicPage.getByRole("navigation", { name: "Основная навигация" });
      await expect(primaryNavigation.getByRole("link", { name: menuLabel })).toBeVisible();
      await expect(publicPage.locator("footer").getByText(footerDescription)).toBeVisible();
    } finally {
      await publicContext.close();
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
