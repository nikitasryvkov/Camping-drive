import { expect, test } from "@playwright/test";

test("публичный сайт работает без горизонтального переполнения на мобильном устройстве", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();

  await page.getByRole("button", { name: "Открыть меню" }).click();
  const menu = page.getByRole("dialog", { name: "Меню" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link")).not.toHaveCount(0);
  await menu.getByRole("button", { name: "Закрыть меню" }).click();
  await expect(menu).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY > 0)).toBeTruthy();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.clientWidth).toBe(layout.viewportWidth);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  for (const mobilePath of ["/news", "/admin/login"]) {
    await page.goto(mobilePath);
    await expect(page.locator("h1")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow, `Горизонтальное переполнение на ${mobilePath}`).toBeFalsy();
  }
});
