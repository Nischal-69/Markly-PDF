import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");
const CORRUPT = path.resolve(HERE, "../fixtures/corrupt.pdf");
const MIXED = path.resolve(HERE, "../fixtures/markly-mixed.pdf");

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

test("fit page, keyboard navigation, ctrl+wheel zoom, search placeholder", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });

  // Fit whole page: first page must fit vertically inside the scroll area.
  await page.getByRole("button", { name: "Fit whole page in view" }).click();
  await page.waitForTimeout(800);
  const fits = await page.evaluate(() => {
    const scroll = document.querySelector(".pdf-scroll") as HTMLElement;
    const first = document.querySelector(".pdf-page") as HTMLElement;
    return {
      pageH: first.getBoundingClientRect().height,
      availH: scroll.clientHeight - 72,
      zoom: document.querySelector(".zoom-label")?.textContent,
    };
  });
  expect(fits.pageH).toBeLessThanOrEqual(fits.availH + 2);
  expect(fits.zoom).toContain("%");

  // Keyboard: PageDown → 2, End → 5, Home → 1, arrows move one page.
  await page.keyboard.press("PageDown");
  await expect(page.getByText("Page 2 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("End");
  await expect(page.getByText("Page 5 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Home");
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Page 2 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Ctrl + mouse wheel zooms (synthetic ctrl-wheel on the scroll container).
  const zoomLabel = page.locator(".zoom-label");
  const before = await zoomLabel.innerText();
  await page.evaluate(() => {
    const scroll = document.querySelector(".pdf-scroll") as HTMLElement;
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect(zoomLabel).not.toHaveText(before, { timeout: 10_000 });

  // Ctrl+F shows the search placeholder toast instead of browser find.
  await page.keyboard.press("Control+f");
  await expect(page.getByText("PDF search is coming in a later batch.")).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "tests/screenshots/06-keyboard.png" });
});

test("save a copy downloads the PDF", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Save a copy of this PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("markly-5page");
  await expect(page.getByText(/Saved a copy of/)).toBeVisible({ timeout: 10_000 });
});

test("fullscreen viewer toggles", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Fullscreen viewer" }).click();
  await expect
    .poll(
      async () => page.evaluate(() => document.fullscreenElement !== null),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
  await page.screenshot({ path: "tests/screenshots/07-fullscreen.png" });

  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect
    .poll(
      async () => page.evaluate(() => document.fullscreenElement === null),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("mixed portrait/landscape document", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, MIXED);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText("Page 1 of 2", { exact: true }).first()).toBeVisible();

  // Landscape page is wider than tall.
  const landscape = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".pdf-page")];
    const rects = pages.map((p) => (p as HTMLElement).getBoundingClientRect());
    return rects.map((r) => ({ w: Math.round(r.width), h: Math.round(r.height) }));
  });
  expect(landscape.length).toBe(2);
  expect(landscape[1].w).toBeGreaterThan(landscape[1].h);

  // Fit page on the landscape page keeps it fully visible.
  await page.locator(".thumb-item").nth(1).click();
  await page.getByRole("button", { name: "Fit whole page in view" }).click();
  await page.waitForTimeout(800);
  const fits = await page.evaluate(() => {
    const scroll = document.querySelector(".pdf-scroll") as HTMLElement;
    const second = document.querySelectorAll(".pdf-page")[1] as HTMLElement;
    const r = second.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), sLeft: Math.round(s.left), sRight: Math.round(s.right) };
  });
  expect(fits.left).toBeGreaterThanOrEqual(fits.sLeft - 2);
  expect(fits.right).toBeLessThanOrEqual(fits.sRight + 2);
});
