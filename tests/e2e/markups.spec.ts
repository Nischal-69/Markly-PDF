import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");
const STORE_KEY = "markly.markups.v1";

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
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(800);
}

async function spanCenter(page: Page, pageNum: number, substr: string) {
  const rect = await page.evaluate(
    ([pn, sub]) => {
      const pg = document.querySelector(`.pdf-page[data-page-number="${pn}"]`);
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])];
      const el = (spans as HTMLElement[]).find((s) =>
        (s.textContent ?? "").includes(sub),
      );
      el?.scrollIntoView({ block: "center" });
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    },
    [pageNum, substr] as const,
  );
  expect(rect, `span containing "${substr}" exists`).not.toBeNull();
  await page.waitForTimeout(350);
  return rect as { x: number; y: number; width: number; height: number };
}

async function selectSpanText(page: Page, pageNum: number, substr: string) {
  const line = await spanCenter(page, pageNum, substr);
  const y = line.y + line.height / 2;
  await page.mouse.move(line.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(line.x + 200, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
}

async function measurePage(page: Page, pageNum: number) {
  const box = await page.evaluate((pn) => {
    const el = document.querySelector(
      `.pdf-page[data-page-number="${pn}"]`,
    ) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, pageNum);
  expect(box, `page ${pageNum} exists`).not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

/**
 * Centers a page-relative fractional point in the viewport so synthetic
 * mouse events land on the real page (pages are taller than the window).
 */
async function centerPointInView(page: Page, pageNum: number, fx: number, fy: number) {
  const VW = 1280;
  const VH = 800;
  for (let i = 0; i < 4; i++) {
    const box = await measurePage(page, pageNum);
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    if (x > 100 && x < VW - 100 && y > 140 && y < VH - 60) {
      return { box, x, y };
    }
    await page.evaluate(
      ([dx, dy]) => {
        document.querySelector(".pdf-scroll")?.scrollBy(dx, dy);
      },
      [x - VW / 2, y - VH / 2] as const,
    );
    await page.waitForTimeout(300);
  }
  const box = await measurePage(page, pageNum);
  return { box, x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function drawShape(
  page: Page,
  pageNum: number,
  x1f: number,
  y1f: number,
  x2f: number,
  y2f: number,
) {
  await centerPointInView(page, pageNum, (x1f + x2f) / 2, (y1f + y2f) / 2);
  const box = await measurePage(page, pageNum);
  await drag(
    page,
    box.x + box.width * x1f,
    box.y + box.height * y1f,
    box.x + box.width * x2f,
    box.y + box.height * y2f,
  );
}

/** Clicks the center of a markup (scrolls it into view first). */
async function clickMarkupCenter(page: Page, selector: string) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const b = await loc.boundingBox();
  expect(b, `${selector} has a box`).not.toBeNull();
  await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
}

async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 15 });
  await page.mouse.up();
}

async function storedMarkups(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown[]>;
    return Object.values(parsed).flat();
  }, STORE_KEY);
}

test("annotation toolbar shows every tool", async ({ page }) => {
  await openViewer(page);
  const bar = page.getByRole("toolbar", { name: "Annotation tools" });
  for (const name of [
    "Select",
    "Underline",
    "Strikethrough",
    "Freehand drawing",
    "Rectangle",
    "Circle",
    "Arrow",
    "Text annotation",
  ]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Text-selection toolbar also offers underline + strikethrough.
  await selectSpanText(page, 1, "Line 10");
  await expect(page.getByRole("button", { name: "Underline selection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Strikethrough selection" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("underline + strikethrough: create, zoom/scroll alignment, edit, persist", async ({
  page,
}) => {
  await openViewer(page);

  await selectSpanText(page, 1, "Line 10");
  await page.getByRole("button", { name: "Underline selection" }).click();
  const underline = page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="underline"]');
  await expect(underline.first()).toBeVisible({ timeout: 10_000 });

  await selectSpanText(page, 1, "Line 12");
  await page.getByRole("button", { name: "Strikethrough selection" }).click();
  const strike = page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="strike"]');
  await expect(strike.first()).toBeVisible({ timeout: 10_000 });

  // Persisted as overlay metadata (PDF bytes untouched).
  const stored = (await storedMarkups(page)) as Array<Record<string, unknown>>;
  expect(stored.map((m) => m.kind).sort()).toEqual(["strike", "underline"]);
  const first = stored[0] as Record<string, unknown>;
  for (const field of ["id", "docId", "page", "kind", "color", "stroke", "quads", "createdAt"]) {
    expect(first, `markup has ${field}`).toHaveProperty(field);
  }

  // Zoom keeps alignment: projected offset scales with the zoom ratio.
  const quad = underline.first();
  const pct = async () =>
    parseFloat((await page.locator(".zoom-label").innerText()).replace("%", ""));
  const leftPx = async () =>
    parseFloat((await quad.evaluate((el) => (el as HTMLElement).style.left)) || "0");
  const beforeLeft = await leftPx();
  const beforePct = await pct();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(pct, { timeout: 10_000 }).toBeGreaterThan(beforePct);
  const afterPct = await pct();
  expect(Math.abs((await leftPx()) - (afterPct / beforePct) * beforeLeft)).toBeLessThan(2);

  // Scroll away and back: offset inside the page is stable.
  const offsetInPage = () =>
    page.evaluate(() => {
      const q = document.querySelector(
        '.pdf-page[data-page-number="1"] [data-markup-kind="underline"]',
      ) as HTMLElement;
      const p = document.querySelector('.pdf-page[data-page-number="1"]') as HTMLElement;
      const qr = q.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      return { x: qr.left - pr.left, y: qr.top - pr.top };
    });
  const offBefore = await offsetInPage();
  await page.locator(".thumb-item").nth(4).click();
  await expect(page.getByText("Page 5 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.locator(".thumb-item").nth(0).click();
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  const offAfter = await offsetInPage();
  expect(Math.abs(offAfter.x - offBefore.x)).toBeLessThan(2);
  expect(Math.abs(offAfter.y - offBefore.y)).toBeLessThan(2);

  // Close + reopen: both markups restored.
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible({ timeout: 10_000 });
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-markup-kind="underline"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-markup-kind="strike"]').first()).toBeVisible({ timeout: 20_000 });

  // Click an underline → editor → delete it; strike survives.
  await clickMarkupCenter(page, '[data-markup-kind="underline"]');
  await expect(page.getByRole("dialog", { name: "Edit underline" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Delete underline" }).click();
  await expect(page.locator('[data-markup-kind="underline"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-markup-kind="strike"]').first()).toBeVisible();
});

test("shapes on multiple pages: rect, circle, arrow, freehand + edit + delete", async ({
  page,
}) => {
  await openViewer(page);
  const bar = page.getByRole("toolbar", { name: "Annotation tools" });

  // Rectangle on page 1.
  await bar.getByRole("button", { name: "Rectangle", exact: true }).click();
  await drawShape(page, 1, 0.1, 0.55, 0.35, 0.62);
  const rect = page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="rect"]');
  await expect(rect).toBeVisible({ timeout: 10_000 });

  // Circle on page 1.
  await bar.getByRole("button", { name: "Circle", exact: true }).click();
  await drawShape(page, 1, 0.55, 0.55, 0.85, 0.62);
  await expect(
    page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="ellipse"]'),
  ).toBeVisible({ timeout: 10_000 });

  // Arrow on page 1.
  await bar.getByRole("button", { name: "Arrow", exact: true }).click();
  await drawShape(page, 1, 0.1, 0.7, 0.4, 0.74);
  await expect(
    page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="arrow"]'),
  ).toBeVisible({ timeout: 10_000 });

  // Freehand zigzag on page 1.
  await bar.getByRole("button", { name: "Freehand drawing", exact: true }).click();
  const start = await centerPointInView(page, 1, 0.27, 0.3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [dx, dy] of [[-100, 25], [-40, -20], [40, 25], [100, -10]] as const) {
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  }
  await page.mouse.up();
  await expect(
    page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="freehand"]'),
  ).toBeVisible({ timeout: 10_000 });

  // Rectangle on page 2 (multi-page coverage).
  await page.locator(".thumb-item").nth(1).click();
  await bar.getByRole("button", { name: "Rectangle", exact: true }).click();
  await drawShape(page, 2, 0.15, 0.55, 0.4, 0.62);
  await expect(
    page.locator('.pdf-page[data-page-number="2"] [data-markup-kind="rect"]'),
  ).toBeVisible({ timeout: 10_000 });

  const kinds = ((await storedMarkups(page)) as Array<Record<string, unknown>>).map((m) => m.kind);
  for (const kind of ["rect", "ellipse", "arrow", "freehand"]) {
    expect(kinds, `stored ${kind}`).toContain(kind);
  }
  expect(kinds.filter((k) => k === "rect")).toHaveLength(2);

  // Zoom scales shape geometry proportionally.
  const shapeLeft = () =>
    rect.evaluate((el) => parseFloat((el as HTMLElement).style.left) || 0);
  const pct = async () =>
    parseFloat((await page.locator(".zoom-label").innerText()).replace("%", ""));
  // Back to page 1 for the zoom check.
  await page.locator(".thumb-item").nth(0).click();
  await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  const beforeLeft = await shapeLeft();
  const beforePct = await pct();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(pct, { timeout: 10_000 }).toBeGreaterThan(beforePct);
  const afterPct = await pct();
  expect(Math.abs((await shapeLeft()) - (afterPct / beforePct) * beforeLeft)).toBeLessThan(2);

  // Select the rectangle → editor → recolor + thicker line.
  await bar.getByRole("button", { name: "Select", exact: true }).click();
  await clickMarkupCenter(page, '.pdf-page[data-page-number="1"] [data-markup-kind="rect"]');
  await expect(page.getByRole("dialog", { name: "Edit rectangle" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Change annotation color to Blue" }).click();
  const borderColor = await rect
    .locator(".mk-rect-border")
    .evaluate((el) => getComputedStyle(el).borderColor);
  expect(borderColor).toContain("15, 108, 189");
  await page.getByRole("button", { name: "Set line thickness thick" }).click();
  await page.keyboard.press("Escape");

  // Delete the arrow via its editor.
  const arrow = page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="arrow"]');
  await clickMarkupCenter(page, '.pdf-page[data-page-number="1"] [data-markup-kind="arrow"]');
  await expect(page.getByRole("dialog", { name: "Edit arrow" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Delete arrow" }).click();
  await expect(
    page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="arrow"]'),
  ).toHaveCount(0, { timeout: 10_000 });
  // Everything else survives.
  await expect(rect).toBeVisible();
  await expect(
    page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="freehand"]'),
  ).toBeVisible();
});

test("text annotation: place, edit, zoom, persist", async ({ page }) => {
  await openViewer(page);
  const bar = page.getByRole("toolbar", { name: "Annotation tools" });

  const spot1 = await centerPointInView(page, 1, 0.7, 0.25);
  await bar.getByRole("button", { name: "Text annotation", exact: true }).click();
  await page.mouse.click(spot1.x, spot1.y);
  await expect(page.getByRole("dialog", { name: "Add text annotation" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Text annotation content").fill("Margin reminder for chapter one.");
  await page.getByRole("button", { name: "Save annotation" }).click();

  const card = page.locator('.pdf-page[data-page-number="1"] [data-markup-kind="text"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Margin reminder for chapter one.");

  // Text on page 2 as well.
  await page.locator(".thumb-item").nth(1).click();
  const spot2 = await centerPointInView(page, 2, 0.7, 0.25);
  await bar.getByRole("button", { name: "Text annotation", exact: true }).click();
  await page.mouse.click(spot2.x, spot2.y);
  await expect(page.getByRole("dialog", { name: "Add text annotation" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Text annotation content").fill("Second page follow-up.");
  await page.getByRole("button", { name: "Save annotation" }).click();
  await expect(
    page.locator('.pdf-page[data-page-number="2"] [data-markup-kind="text"]'),
  ).toContainText("Second page follow-up.");

  // Edit the page-1 card text.
  await page.locator(".thumb-item").nth(0).click();
  await bar.getByRole("button", { name: "Select", exact: true }).click();
  await clickMarkupCenter(page, '.pdf-page[data-page-number="1"] [data-markup-kind="text"]');
  await expect(page.getByRole("dialog", { name: "Edit text annotation" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Text annotation content").fill("Margin reminder v2.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card).toContainText("Margin reminder v2.");

  // Zoom scales the card text.
  const fontPx = () =>
    card.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
  const before = await fontPx();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(fontPx, { timeout: 10_000 }).toBeGreaterThan(before);

  // Reopen restores both text annotations.
  await page.getByRole("button", { name: "Close document" }).click();
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible({ timeout: 10_000 });
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-markup-kind="text"]')).toHaveCount(2, { timeout: 20_000 });
});
