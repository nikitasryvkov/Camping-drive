import { expect, type Page } from "@playwright/test";

import { stage9Administrator } from "./test-environment";

export async function loginAsAdministrator(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Логин").fill(stage9Administrator.login);
  await page.getByLabel("Пароль").fill(stage9Administrator.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation", { name: "Разделы админ-панели" })).toBeVisible();
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
