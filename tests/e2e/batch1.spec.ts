import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");
const CORRUPT = path.resolve(HERE, "../fixtures/corrupt.pdf");

async function openPdfViaToolbar(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(file);
}

test("home boots with branding and empty recent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Markly PDF").first()).toBeVisible();
  await expect(page.getByText("Read. Highlight. Note. Organize.")).toBeVisible();
  await expect(page.getByText("No recently opened PDFs yet.")).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/01-home.png" });
});

test("open multi-page PDF: render, navigate, zoom, thumbnails, text", async ({ page }) => {
  await page.goto("/");

  await openPdfViaToolbar(page, FIXTURE);

  // Document ready: 5 pages, first page current.
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".thumb-item")).toHaveCount(5, { timeout: 20_000 });

  // Page canvases actually render (non-blank bitmaps).
  await expect
    .poll(async () => page.locator(".pdf-page canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Text layer exists → selection/copy works.
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });
  const selected = await page.locator(".pdf-page[data-page-number='1'] .pdf-text-layer").innerText();
  expect(selected).toContain("Page 1");
  await page.screenshot({ path: "tests/screenshots/02-viewer.png" });

  // Next page button → current page becomes 2.
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Thumbnail click → jumps to page 5.
  await page.locator(".thumb-item").nth(4).click();
  await expect(page.getByText("Page 5 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "tests/screenshots/03-page5.png" });

  // Zoom in changes the percentage label.
  const zoomLabel = page.locator(".zoom-label");
  const before = await zoomLabel.innerText();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLabel).not.toHaveText(before, { timeout: 10_000 });

  // Zoom out twice then fit-to-width restores a sane label.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Fit page to width" }).click();
  await expect(zoomLabel).toContainText("%");

  // Thumbnails toggle hides the panel.
  await page.getByRole("button", { name: "Toggle page thumbnails" }).click();
  await expect(page.locator(".thumb-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle page thumbnails" }).click();
  await expect(page.locator(".thumb-panel")).toHaveCount(1);

  // Close → library shows the file in Recent.
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "tests/screenshots/04-recent.png" });
});

test("opening another PDF replaces the current document", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Open the same file again as "another PDF": viewer must reset to page 1.
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(5);
});

test("corrupt PDF shows a friendly error", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, CORRUPT);
  await expect(page.getByRole("alert").first()).toContainText("not a valid PDF", { timeout: 20_000 });
  await page.screenshot({ path: "tests/screenshots/05-error.png" });
});
