import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMALL = path.resolve(HERE, "../fixtures/markly-5page.pdf");
const LARGE = path.resolve(HERE, "../fixtures/markly-large.pdf");
const IMAGES = path.resolve(HERE, "../fixtures/markly-images.pdf");
const CORRUPT = path.resolve(HERE, "../fixtures/corrupt.pdf");

async function openPdfViaToolbar(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(file);
}

/** Fails the test on any console error / uncaught exception. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

function expectNoErrors(errors: string[]) {
  expect(errors, `expected no console/page errors, got: ${errors.join("\n")}`).toEqual([]);
}

function browserDocId(file: string): string {
  const name = path.basename(file);
  const size = fs.statSync(file).size;
  return `file:${name}:${size}`;
}

test("small PDF: open, close, reopen cleanly", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await openPdfViaToolbar(page, SMALL);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".thumb-item")).toHaveCount(5, { timeout: 20_000 });
  await expect(page.locator(".pdf-page-error")).toHaveCount(0);

  // Close releases the document; the library takes over.
  // (Note: getByRole("document") also matches the root <html> node, so
  // assert on the viewer container instead.)
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.locator(".viewer-area")).toHaveCount(0);
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible({ timeout: 10_000 });

  // Reopening works from a clean slate.
  await openPdfViaToolbar(page, SMALL);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });
  expectNoErrors(errors);
});

test("120-page PDF: scrolls, zooms and thumbnails without errors", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await openPdfViaToolbar(page, LARGE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(120, { timeout: 30_000 });

  // Jump to the last page via thumbnails.
  await page.locator(".thumb-item").nth(119).click();
  await expect(page.getByText("Page 120 of 120", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Zoom in and back out on a large document.
  const zoomLabel = page.locator(".zoom-label");
  const before = await zoomLabel.innerText();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLabel).not.toHaveText(before, { timeout: 10_000 });
  await page.getByRole("button", { name: "Zoom out" }).click();

  // Back to the top via keyboard.
  await page.keyboard.press("Home");
  await expect(page.getByText("Page 1 of 120", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Every attempted page rendered (no per-page failures).
  await expect(page.locator(".pdf-page-error")).toHaveCount(0);
  await expect
    .poll(async () => page.locator(".pdf-page canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  expectNoErrors(errors);
});

test("image + large-file PDF renders with selectable text", async ({ page }) => {
  const errors = watchForErrors(page);
  expect(fs.statSync(IMAGES).size).toBeGreaterThan(1_000_000);
  await page.goto("/");
  await openPdfViaToolbar(page, IMAGES);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Page 1 of 6", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Raster pages still carry a selectable text layer.
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });
  const firstPageText = await page
    .locator(".pdf-page[data-page-number='1'] .pdf-text-layer")
    .innerText();
  expect(firstPageText).toContain("Gallery page 1");

  // Thumbnails + last-page navigation on an image-heavy file.
  await expect(page.locator(".thumb-item")).toHaveCount(6, { timeout: 20_000 });
  await page.keyboard.press("End");
  await expect(page.getByText("Page 6 of 6", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-page-error")).toHaveCount(0);
  expectNoErrors(errors);
});

test("corrupt PDF fails safely and the app recovers", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await openPdfViaToolbar(page, CORRUPT);
  await expect(page.getByRole("alert").first()).toContainText("not a valid PDF", { timeout: 20_000 });

  // Dismiss and open a valid document: nothing wedged, nothing leaked.
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await openPdfViaToolbar(page, SMALL);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".pdf-page-error")).toHaveCount(0);
  expectNoErrors(errors);
});

test("240 highlights across 120 pages stay smooth", async ({ page }) => {
  const errors = watchForErrors(page);
  const docId = browserDocId(LARGE);
  const colors = ["yellow", "green", "blue", "orange", "pink", "purple"];
  await page.goto("/");
  await page.evaluate(
    ([docIdValue, palette]) => {
      const now = Date.now();
      const map: Record<string, unknown[]> = {};
      const list: unknown[] = [];
      for (let p = 1; p <= 120; p += 1) {
        for (let k = 0; k < 2; k += 1) {
          list.push({
            id: `hl_perf_${p}_${k}`,
            docId: docIdValue,
            page: p,
            text: `Sample text page ${p}`,
            color: (palette as string[])[(p + k) % (palette as string[]).length],
            range: { beginDiv: 0, beginOffset: 0, endDiv: 0, endOffset: 6 },
            quads: [{ left: 72, top: 100 + k * 24, width: 200, height: 14 }],
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      map[docIdValue as string] = list;
      window.localStorage.setItem("markly.highlights.v1", JSON.stringify(map));
    },
    [docId, colors] as const,
  );

  await openPdfViaToolbar(page, LARGE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(120, { timeout: 30_000 });

  // Scroll the whole document end to end; overlays mount per page.
  await page.keyboard.press("End");
  await expect(page.getByText("Page 120 of 120", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => page.locator(".hl").count(), { timeout: 30_000 })
    .toBeGreaterThan(200);
  await expect(page.locator(".pdf-page-error")).toHaveCount(0);

  await page.keyboard.press("Home");
  await expect(page.getByText("Page 1 of 120", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  expectNoErrors(errors);
});

test("40 notes render in the panel without errors", async ({ page }) => {
  const errors = watchForErrors(page);
  const docId = browserDocId(SMALL);
  await page.goto("/");
  await page.evaluate((docIdValue) => {
    const now = Date.now();
    const notes: unknown[] = [];
    for (let i = 0; i < 40; i += 1) {
      notes.push({
        id: `note_perf_${i}`,
        docId: docIdValue,
        docName: "markly-5page.pdf",
        page: (i % 5) + 1,
        kind: "page",
        selectedText: "",
        title: `Perf note ${i}`,
        content: `Body text for performance note number ${i}.`,
        x: 0,
        y: 0,
        createdAt: now - i,
        updatedAt: now - i,
      });
    }
    window.localStorage.setItem("markly.notes.v1", JSON.stringify(notes));
  }, docId);
  await page.reload();

  await page.getByRole("button", { name: "Notes" }).click();
  await expect(page.locator(".note-row")).toHaveCount(40, { timeout: 10_000 });

  // Search filters the large list.
  await page.getByLabel("Search notes").fill("Perf note 1");
  await expect(page.locator(".note-row").first()).toBeVisible({ timeout: 10_000 });
  expectNoErrors(errors);
});
