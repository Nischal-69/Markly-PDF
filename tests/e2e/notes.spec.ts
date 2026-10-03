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

async function openViewer(page: Page) {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.locator(".pdf-scroll")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
}

async function spanRect(page: Page, pageNum: number, substr: string) {
  const rect = await page.evaluate(
    ([pn, sub]) => {
      const pg = document.querySelector(`.pdf-page[data-page-number="${pn}"]`);
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])];
      const el = (spans as HTMLElement[]).find((s) =>
        (s.textContent ?? "").includes(sub),
      );
      el?.scrollIntoView({ block: "center" });
      const r = el?.getBoundingClientRect();
      return r
        ? { x: r.x, y: r.y, width: r.width, height: r.height }
        : null;
    },
    [pageNum, substr] as const,
  );
  expect(rect, `span containing "${substr}" exists`).not.toBeNull();
  await page.waitForTimeout(350);
  return rect as { x: number; y: number; width: number; height: number };
}

test("selection note: create, pin, edit, reopen persists", async ({ page }) => {
  await openViewer(page);

  const line = await spanRect(page, 1, "Line 10");
  const y = line.y + line.height / 2;
  await page.mouse.move(line.x + 30, y);
  await page.mouse.down();
  await page.mouse.move(line.x + 160, y, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator(".hl-toolbar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Add Note" }).click();

  await expect(page.getByRole("dialog", { name: "Add note" })).toBeVisible();
  await page.getByLabel("Note title").fill("Key argument");
  await page.getByLabel("Note content").fill("Revisit this paragraph before Friday.");
  await page.getByRole("button", { name: "Save note" }).click();

  const pin = page.locator('.pdf-page[data-page-number="1"] .note-pin').first();
  await expect(pin).toBeVisible({ timeout: 10_000 });

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("markly.notes.v1");
    return raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
  });
  expect(stored.length).toBeGreaterThanOrEqual(1);
  const note = stored[0] as Record<string, unknown>;
  for (const field of [
    "id",
    "docId",
    "docName",
    "page",
    "title",
    "content",
    "x",
    "y",
    "createdAt",
    "updatedAt",
  ]) {
    expect(note, `note has ${field}`).toHaveProperty(field);
  }
  expect(note.kind).toBe("selection");
  expect(note.page).toBe(1);
  expect(note.title).toBe("Key argument");
  expect((note.selectedText as string).length).toBeGreaterThan(0);

  // Click pin → popup with view; edit it.
  await pin.click();
  await expect(page.locator(".note-popup")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".note-popup-title")).toContainText("Key argument");
  await page.getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("dialog", { name: "Edit note" })).toBeVisible();
  await page.getByLabel("Note title").fill("Key argument v2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".note-popup-title")).toContainText("Key argument v2");

  // Close popup, reload, reopen → note persists (reopening app).
  await page.getByRole("button", { name: "Close note" }).click();
  await expect(page.locator(".note-popup")).toHaveCount(0);
  await page.reload();
  await openPdfViaToolbar(page, FIXTURE);
  await expect(page.locator(".pdf-scroll")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.pdf-page[data-page-number="1"] .note-pin').first(),
  ).toBeVisible({ timeout: 20_000 });
});

test("page note + notes panel navigation + delete", async ({ page }) => {
  await openViewer(page);

  // Page note via toolbar.
  await page.getByRole("button", { name: "Add page note" }).click();
  await expect(page.getByRole("dialog", { name: "Add note" })).toBeVisible();
  await page.getByLabel("Note title").fill("Chapter summary");
  await page.getByLabel("Note content").fill("Whole-page takeaway.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.locator(".note-pin").first()).toBeVisible({ timeout: 10_000 });

  // Notes panel lists title, PDF name, page, preview, modified date.
  await page.getByRole("button", { name: "Notes" }).first().click();
  await expect(page.getByText("Chapter summary").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("markly-5page.pdf").first()).toBeVisible();
  await expect(page.getByText(/Page 1/).first()).toBeVisible();
  await expect(page.getByText(/Whole-page takeaway/).first()).toBeVisible();

  // Clicking a note opens the PDF, navigates, focuses the note popup.
  await page.getByText("Chapter summary").first().click();
  await expect(page.locator(".pdf-scroll")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".note-popup")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".note-popup-title")).toContainText("Chapter summary");

  // Delete from popup.
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.locator(".note-popup")).toHaveCount(0, { timeout: 10_000 });
});
