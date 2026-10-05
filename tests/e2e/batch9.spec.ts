import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");

async function openPdfViaToolbar(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(file);
}

async function theme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset.theme ?? null);
}

test("batch9: appearance switcher offers Light, Dark and System", async ({ page }) => {
  await page.goto("/");
  const group = page.getByRole("radiogroup", { name: "Appearance" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("radio", { name: "Light mode" })).toBeVisible();
  await expect(group.getByRole("radio", { name: "Dark mode" })).toBeVisible();
  await expect(group.getByRole("radio", { name: "Follow the system theme" })).toBeVisible();
  // Default is System, resolved against the OS (light in headless CI).
  expect(await theme(page)).toBe("light");
});

test("batch9: dark mode applies and persists across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark mode" }).click();
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Light mode" }).click();
  expect(await theme(page)).toBe("light");
});

test("batch9: system theme follows the OS", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark mode" }).click();
  expect(await theme(page)).toBe("dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("radio", { name: "Follow the system theme" }).click();
  await page.reload();
  expect(await theme(page)).toBe("dark");

  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  expect(await theme(page)).toBe("light");
});

test("batch9: viewer renders in dark mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark mode" }).click();
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible();
  // Chrome chrome stays themed: toolbar + sidebar + annotation tools.
  await expect(page.getByRole("button", { name: "Save project", exact: true })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
});
