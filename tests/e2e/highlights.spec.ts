import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openPdfViaToolbar(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(file);
}

async function openViewer(page: Page) {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
}

/** Bounding box of the Nth text span containing `substr` on a page. */
async function spanRectByText(
  page: Page,
  pageNum: number,
  substr: string,
  occurrence = 0,
): Promise<Rect> {
  const rect = await page.evaluate(
    ([pn, sub, occ]) => {
      const pg = document.querySelector(`.pdf-page[data-page-number="${pn}"]`);
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])];
      const matches = (spans as HTMLElement[]).filter((s) =>
        (s.textContent ?? "").includes(sub),
      );
      const el = matches[occ];
      // Drag targets may sit below the fold — bring them into view first
      // so synthetic mouse events land on real text.
      el?.scrollIntoView({ block: "center" });
      const r = el?.getBoundingClientRect();
      return r
        ? { x: r.x, y: r.y, width: r.width, height: r.height }
        : null;
    },
    [pageNum, substr, occurrence] as const,
  );
  expect(rect, `span containing "${substr}" exists`).not.toBeNull();
  // Let the scroll settle before measuring mouse coordinates.
  await page.waitForTimeout(350);
  const settled = await page.evaluate(
    ([pn, sub, occ]) => {
      const pg = document.querySelector(`.pdf-page[data-page-number="${pn}"]`);
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])];
      const matches = (spans as HTMLElement[]).filter((s) =>
        (s.textContent ?? "").includes(sub),
      );
      const r = matches[occ]?.getBoundingClientRect();
      return r
        ? { x: r.x, y: r.y, width: r.width, height: r.height }
        : null;
    },
    [pageNum, substr, occurrence] as const,
  );
  return settled as Rect;
}

async function dragSelect(page: Page, from: Rect, to: Rect) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
}

async function partialDrag(page: Page, span: Rect, fromX: number, toX: number) {
  const y = span.y + span.height / 2;
  await page.mouse.move(span.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(span.x + toX, y, { steps: 10 });
  await page.mouse.up();
}

test("short selection shows toolbar and creates a yellow highlight", async ({
  page,
}) => {
  await openViewer(page);

  const line = await spanRectByText(page, 1, "Line 10");
  await partialDrag(page, line, 30, 160);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Highlight Yellow" }).click();
  const quads = page.locator('.pdf-page[data-page-number="1"] .hl-yellow');
  await expect(quads).not.toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".hl-toolbar")).toHaveCount(0);

  // The PDF text itself is untouched and readable.
  const layerText = await page
    .locator('.pdf-page[data-page-number="1"] .pdf-text-layer')
    .innerText();
  expect(layerText).toContain("Line 10");

  // Persisted with range + quads + color + text.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("markly.highlights.v1");
    return raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
  });
  const all = Object.values(stored).flat();
  expect(all.length).toBeGreaterThanOrEqual(1);
  const first = all[0] as Record<string, unknown>;
  expect(first.page).toBe(1);
  expect(first.color).toBe("yellow");
  expect((first.text as string).length).toBeGreaterThan(0);
  expect((first.quads as unknown[]).length).toBeGreaterThan(0);
  expect(first.range).toMatchObject({
    beginDiv: expect.any(Number),
    endDiv: expect.any(Number),
  });

  await page.screenshot({ path: "tests/screenshots/08-highlight.png" });
});

test("multiline, colors, overlap, recolor, delete", async ({ page }) => {
  await openViewer(page);

  // Multi-line selection across three lines → green, several quads.
  const from = await spanRectByText(page, 1, "Line 05");
  const to = await spanRectByText(page, 1, "Line 07");
  await dragSelect(page, from, to);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight Green" }).click();
  const green = page.locator(".hl-green");
  await expect
    .poll(async () => green.count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);

  // Overlapping selection (starts on the green highlight) → pink.
  const over1 = await spanRectByText(page, 1, "Line 06");
  const over2 = await spanRectByText(page, 1, "Line 08");
  await dragSelect(page, over1, over2);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight Pink" }).click();
  await expect(page.locator(".hl-pink").first()).toBeVisible({
    timeout: 10_000,
  });

  const greenIds = await green.evaluateAll((els) => [
    ...new Set(els.map((e) => e.getAttribute("data-highlight-id"))),
  ]);
  const pinkIds = await page
    .locator(".hl-pink")
    .evaluateAll((els) => [
      ...new Set(els.map((e) => e.getAttribute("data-highlight-id"))),
    ]);
  expect(greenIds.length).toBe(1);
  expect(pinkIds.length).toBe(1);
  expect(pinkIds[0]).not.toBe(greenIds[0]);

  // Click the green highlight → editor → recolor to blue.
  const greenBox = await green.first().boundingBox();
  expect(greenBox).not.toBeNull();
  await page.mouse.click(
    greenBox!.x + greenBox!.width / 2,
    greenBox!.y + greenBox!.height / 2,
  );
  await expect(page.locator(".hl-editor")).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("button", { name: "Change highlight color to Blue" })
    .click();
  await expect(page.locator(".hl-green")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".hl-blue").first()).toBeVisible({
    timeout: 10_000,
  });

  // Click the blue highlight → editor → delete it.
  const blueBox = await page.locator(".hl-blue").first().boundingBox();
  await page.mouse.click(
    blueBox!.x + blueBox!.width / 2,
    blueBox!.y + blueBox!.height / 2,
  );
  await expect(page.locator(".hl-editor")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Delete highlight" }).click();
  await expect(page.locator(".hl-blue")).toHaveCount(0, { timeout: 10_000 });
  // Pink overlap survives.
  await expect(page.locator(".hl-pink").first()).toBeVisible();

  await page.screenshot({ path: "tests/screenshots/09-editor.png" });
});

test("selection near page edges", async ({ page }) => {
  await openViewer(page);

  // Last line of page 1.
  const last = await spanRectByText(page, 1, "Line 30");
  await partialDrag(page, last, 10, 200);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight Orange" }).click();
  await expect(
    page.locator('.pdf-page[data-page-number="1"] .hl-orange').first(),
  ).toBeVisible({ timeout: 10_000 });

  // Heading on page 2 (top edge).
  await page.locator(".thumb-item").nth(1).click();
  const head = await spanRectByText(page, 2, "Page 2");
  await partialDrag(page, head, 5, 150);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight Purple" }).click();
  await expect(
    page.locator('.pdf-page[data-page-number="2"] .hl-purple').first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("zoom and scroll keep alignment; reopen restores", async ({ page }) => {
  await openViewer(page);

  const line = await spanRectByText(page, 1, "Line 12");
  await partialDrag(page, line, 20, 220);
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight Yellow" }).click();
  const quad = page.locator(".hl-yellow").first();
  await expect(quad).toBeVisible({ timeout: 10_000 });

  const pct = async () =>
    parseFloat((await page.locator(".zoom-label").innerText()).replace("%", ""));
  const leftPx = async () =>
    parseFloat((await quad.evaluate((el) => (el as HTMLElement).style.left)) || "0");
  const beforeLeft = await leftPx();
  const beforePct = await pct();

  // Zoom in → quads scale proportionally.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(pct, { timeout: 10_000 })
    .toBeGreaterThan(beforePct);
  const afterPct = await pct();
  const afterLeft = await leftPx();
  const expected = (afterPct / beforePct) * beforeLeft;
  expect(Math.abs(afterLeft - expected)).toBeLessThan(2);

  // Scroll away and back → same position relative to the page.
  // (Absolute viewport coords legitimately differ with scroll offset;
  // alignment means quad-minus-page-top is stable.)
  const quadOffsetInPage = () =>
    page.evaluate(() => {
      const q = document.querySelector(
        '.pdf-page[data-page-number="1"] .hl-yellow',
      ) as HTMLElement;
      const p = document.querySelector(
        '.pdf-page[data-page-number="1"]',
      ) as HTMLElement;
      const qr = q.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return { x: qr.left - pr.left, y: qr.top - pr.top };
    });
  const offsetBefore = await quadOffsetInPage();
  await page.locator(".thumb-item").nth(4).click();
  await expect(
    page.getByText("Page 5 of 5", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await page.locator(".thumb-item").nth(0).click();
  await expect(
    page.getByText("Page 1 of 5", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  const offsetAfter = await quadOffsetInPage();
  expect(Math.abs(offsetAfter.x - offsetBefore.x)).toBeLessThan(2);
  expect(Math.abs(offsetAfter.y - offsetBefore.y)).toBeLessThan(2);

  // Close and reopen the same file → highlights restored from storage.
  const countBefore = await page.locator(".hl-yellow").count();
  expect(countBefore).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible({
    timeout: 10_000,
  });
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".hl-yellow")).toHaveCount(countBefore, {
    timeout: 20_000,
  });
  await page.screenshot({ path: "tests/screenshots/10-restored.png" });
});
