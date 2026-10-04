import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");
const LARGE = path.resolve(HERE, "../fixtures/markly-large.pdf");

async function openPdfViaToolbar(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(file);
}

/**
 * The viewer mounts heavy PDF work on open (parse + first render); React
 * passive effects (including the global shortcut listener) flush after the
 * first paint. Waiting for the text layer guarantees the UI is settled
 * before sending keyboard shortcuts.
 */
async function waitForSettledViewer(page: Page) {
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });
}

async function searchFor(page: Page, query: string) {
  await page.getByRole("button", { name: "Search in PDF" }).click();
  const box = page.getByRole("search", { name: "Search in PDF" });
  await expect(box).toBeVisible();
  await box.locator("input").fill(query);
  return box;
}

test("search: bar, counts, highlight, prev/next, jump, Esc", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  // Let the first page paint its text layer.
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });

  const bar = await searchFor(page, "Markly");
  // 5-page fixture: heading (p1) + footers (every page) → several matches.
  await expect(bar.getByRole("status")).toContainText("of", { timeout: 20_000 });
  const countText = await bar.getByRole("status").innerText();
  expect(countText).toMatch(/\d+ of \d+/);

  // Search hits render as overlay boxes without touching highlights.
  await expect(page.locator(".search-hit").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".search-hit.is-active")).toHaveCount(1);

  // Next wraps through results; count label tracks the active match.
  const before = await bar.getByRole("status").innerText();
  await page.getByRole("button", { name: "Next result" }).click();
  await expect(bar.getByRole("status")).not.toHaveText(before, { timeout: 10_000 });
  await expect(page.locator(".search-hit.is-active")).toHaveCount(1);

  // Previous goes back.
  await page.getByRole("button", { name: "Previous result" }).click();
  await expect(bar.getByRole("status")).toHaveText(before, { timeout: 10_000 });

  // Enter in the box = next, Shift+Enter = previous.
  await bar.locator("input").press("Enter");
  await expect(bar.getByRole("status")).not.toHaveText(before, { timeout: 10_000 });
  await bar.locator("input").press("Shift+Enter");
  await expect(bar.getByRole("status")).toHaveText(before, { timeout: 10_000 });

  // No-match query shows an empty state and no boxes.
  await bar.locator("input").fill("zzz_no_such_word_qqx");
  await expect(bar.getByRole("status")).toContainText("No results", { timeout: 20_000 });
  await expect(page.locator(".search-hit")).toHaveCount(0);

  // Esc closes the bar.
  await bar.locator("input").press("Escape");
  await expect(page.getByRole("search", { name: "Search in PDF" })).toHaveCount(0);
});

test("search keyboard: Ctrl+F opens, F3 navigates", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForSettledViewer(page);

  await page.keyboard.press("Control+f");
  const bar = page.getByRole("search", { name: "Search in PDF" });
  await expect(bar).toBeVisible();
  await bar.locator("input").fill("selection");
  await expect(bar.getByRole("status")).toContainText("of", { timeout: 20_000 });

  const label = await bar.getByRole("status").innerText();
  // F3 from outside the input moves to the next match.
  await page.keyboard.press("F3");
  await expect(bar.getByRole("status")).not.toHaveText(label, { timeout: 10_000 });
});

test("bookmarks: toggle, rename, jump, delete, persist", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForSettledViewer(page);

  // Ctrl+D bookmarks page 1.
  await page.keyboard.press("Control+d");
  await expect(page.getByRole("button", { name: /Remove bookmark for page 1/ })).toBeVisible({ timeout: 10_000 });

  // Go to page 3 and bookmark it via the toolbar.
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 3 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Bookmark page 3" }).click();
  await expect(page.getByRole("button", { name: /Remove bookmark for page 3/ })).toBeVisible({ timeout: 10_000 });

  // Bookmarks panel lists both; sidebar badge is gone (shipped feature).
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByText("Page 1", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Page 3", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Rename the page-3 bookmark.
  const row = page.locator(".bookmark-row", { hasText: "Page 3" }).first();
  await row.getByRole("button", { name: "Rename bookmark Page 3" }).click();
  await row.locator(".bookmark-rename").fill("Important section");
  await row.locator(".bookmark-rename").press("Enter");
  await expect(page.getByText("Important section").first()).toBeVisible({ timeout: 10_000 });

  // Click it → jumps back to page 3 in the viewer.
  await page.getByText("Important section").first().click();
  await expect(page.getByText("Page 3 of 5", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Delete the page-1 bookmark from the panel.
  await page.getByRole("button", { name: "Bookmarks" }).click();
  const row1 = page.locator(".bookmark-row", { hasText: "Page 1" }).first();
  await row1.getByRole("button", { name: "Delete bookmark Page 1" }).click();
  await expect(page.locator(".bookmark-row", { hasText: "Page 1" })).toHaveCount(0);

  // Reload → the remaining bookmark persists (localStorage).
  await page.reload();
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByText("Important section").first()).toBeVisible({ timeout: 10_000 });
});

test("large PDF: search streams and jumps without freezing", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, LARGE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(120, { timeout: 30_000 });

  const bar = await searchFor(page, "needle_zqx");
  // Progress streams, then a full count: 28 rows × 120 pages.
  await expect(bar.getByRole("status")).toContainText("of", { timeout: 60_000 });
  const label = await bar.getByRole("status").innerText();
  const total = Number(label.split(" of ")[1]);
  expect(total).toBe(28 * 120);

  // Jump to the last match → viewer reaches the final page.
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "Previous result" }).click();
  }
  await expect(page.getByText("Page 120 of 120", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".search-hit").first()).toBeVisible({ timeout: 20_000 });

  // Highlights layer stays intact (no .hl divs created by search).
  expect(await page.locator(".hl").count()).toBe(0);
});
