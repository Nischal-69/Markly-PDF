import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

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

async function waitForViewer(page: Page) {
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({ timeout: 20_000 });
}

test("batch8: Save / Save As / Export buttons are available", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForViewer(page);

  await expect(page.getByRole("button", { name: "Save project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save project as" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export highlighted PDF" })).toBeVisible();
  // Legacy copy action is preserved (Batch 1).
  await expect(page.getByRole("button", { name: "Save a copy of this PDF" })).toBeVisible();
});

test("batch8: Save project downloads .markly.json and toasts", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForViewer(page);

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".markly.json");
  await expect(page.getByText(/Project saved/)).toBeVisible({ timeout: 10_000 });

  const filePath = await download.path();
  expect(filePath, "download has a path").toBeTruthy();
  const raw = fs.readFileSync(filePath as string, "utf8");
  const project = JSON.parse(raw);
  expect(project.app).toBe("markly-pdf");
  expect(project.docName).toContain("markly-5page");
  expect(Array.isArray(project.highlights)).toBe(true);
  expect(Array.isArray(project.markups)).toBe(true);
  expect(Array.isArray(project.notes)).toBe(true);
});

test("batch8: Export highlighted PDF downloads -annotated.pdf and reopens", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForViewer(page);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Export highlighted PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("-annotated.pdf");
  await expect(page.getByText(/Exported (highlighted )?PDF/)).toBeVisible({ timeout: 10_000 });

  // The export is a real PDF (another reader could open it).
  const filePath = (await download.path()) as string;
  const exportedBytes = fs.readFileSync(filePath);
  const head = exportedBytes.subarray(0, 5).toString("utf8");
  expect(head).toBe("%PDF-");
  // No notes → no Notes page is appended.
  const exportedDoc = await PDFDocument.load(exportedBytes);
  expect(exportedDoc.getPageCount()).toBe(5);

  // Round-trip: the exported file opens again in Markly PDF.
  const saved = await download.createReadStream().then(
    (stream) =>
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c) => chunks.push(c as Buffer));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      }),
  );
  const tmp = path.resolve(HERE, "../fixtures/.tmp-batch8-export.pdf");
  fs.writeFileSync(tmp, saved);
  try {
    await page.getByRole("button", { name: "Close document" }).click();
    await openPdfViaToolbar(page, tmp);
    await waitForViewer(page);
    await expect(page.getByText("Page 1 of 5", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    const exportedPageText = await page
      .locator(".pdf-page[data-page-number='1'] .pdf-text-layer")
      .innerText();
    expect(exportedPageText).toContain("marklypdf");
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best effort
    }
  }
});

test("batch8: export burns highlights and appends Notes page, then reopens", async ({ page }) => {
  await page.goto("/");
  await openPdfViaToolbar(page, FIXTURE);
  await waitForViewer(page);

  // Seed one of every overlay type directly (same shapes the repos persist).
  await page.evaluate(() => {
    const recentRaw = localStorage.getItem("markly.recent.v1") ?? "[]";
    const recent = JSON.parse(recentRaw) as Array<{ id: string }>;
    const docId = recent[0]?.id;
    if (!docId) throw new Error("no recent docId");
    const now = Date.now();
    const quad = { left: 50, top: 100, width: 140, height: 14 };
    localStorage.setItem(
      "markly.highlights.v1",
      JSON.stringify({
        [docId]: [
          {
            id: "hl_export_check",
            docId,
            page: 1,
            text: "Page 1",
            color: "yellow",
            range: { beginDiv: 0, beginOffset: 0, endDiv: 0, endOffset: 6 },
            quads: [quad],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
    const mk = (m: unknown) => m;
    localStorage.setItem(
      "markly.markups.v1",
      JSON.stringify({
        [docId]: [
          mk({ id: "mk_ul", docId, page: 1, kind: "underline", color: "#E81123", stroke: 2, quads: [quad], text: "under", createdAt: now, updatedAt: now }),
          mk({ id: "mk_st", docId, page: 1, kind: "strike", color: "#0F6CBD", stroke: 2, quads: [{ ...quad, top: 130 }], text: "strike", createdAt: now, updatedAt: now }),
          mk({ id: "mk_rect", docId, page: 1, kind: "rect", color: "#E81123", stroke: 2, x: 60, y: 160, w: 120, h: 60, createdAt: now, updatedAt: now }),
          mk({ id: "mk_el", docId, page: 1, kind: "ellipse", color: "#1F9D55", stroke: 2.5, x: 200, y: 160, w: 110, h: 60, createdAt: now, updatedAt: now }),
          mk({ id: "mk_ar", docId, page: 1, kind: "arrow", color: "#7B61FF", stroke: 2, x1: 60, y1: 250, x2: 180, y2: 270, createdAt: now, updatedAt: now }),
          mk({ id: "mk_fh", docId, page: 1, kind: "freehand", color: "#1B1A19", stroke: 2, points: [{ x: 60, y: 300 }, { x: 110, y: 320 }, { x: 170, y: 300 }], createdAt: now, updatedAt: now }),
          mk({ id: "mk_tx", docId, page: 1, kind: "text", color: "#E81123", stroke: 2, x: 60, y: 340, text: "Margin note", fontSize: 14, createdAt: now, updatedAt: now }),
        ],
      }),
    );
    const docName = "markly-5page.pdf";
    localStorage.setItem(
      "markly.notes.v1",
      JSON.stringify([
        { id: "note_export_check", docId, docName, page: 1, kind: "page", selectedText: "", title: "Export check", content: "Round-trip note body", x: 0, y: 0, createdAt: now, updatedAt: now },
      ]),
    );
  });

  // Reopen so the seeded overlays load from storage (notes load at boot).
  await page.reload();
  await openPdfViaToolbar(page, FIXTURE);
  await waitForViewer(page);
  await expect(page.locator(".hl-yellow").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-markup-kind="rect"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-markup-kind="text"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".note-pin").first()).toBeVisible({ timeout: 10_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Export highlighted PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("-annotated.pdf");
  await expect(page.getByText(/Exported highlighted PDF with 1 highlight and 1 note/)).toBeVisible({ timeout: 10_000 });

  // Burned export is a valid PDF (pdf-lib re-serializes compactly, so it
  // can be smaller than the source and still carry the new content).
  const filePath = (await download.path()) as string;
  const bytes = fs.readFileSync(filePath);
  expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);

  // One note → one appended Notes page.
  const exportedDoc = await PDFDocument.load(bytes);
  expect(exportedDoc.getPageCount()).toBe(6);

  // Notes are no longer burned into the original pages.
  const tmp = path.resolve(HERE, "../fixtures/.tmp-batch8-notes-page.pdf");
  fs.writeFileSync(tmp, bytes);
  try {
    await page.getByRole("button", { name: "Close document" }).click();
    await openPdfViaToolbar(page, tmp);
    await waitForViewer(page);
    await expect(page.getByText("Page 1 of 6", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    const firstPageText = await page
      .locator(".pdf-page[data-page-number='1'] .pdf-text-layer")
      .innerText();
    expect(firstPageText).not.toContain("Export check");
    expect(firstPageText).not.toContain("Round-trip note body");
    expect(firstPageText).toContain("marklypdf");

    // The appended page is real text and lists where + what the user noted.
    await page.keyboard.press("End");
    await expect(page.getByText("Page 6 of 6", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator(".pdf-page[data-page-number='6'] .pdf-text-layer span").first(),
    ).toBeAttached({ timeout: 20_000 });
    const notesText = await page
      .locator(".pdf-page[data-page-number='6'] .pdf-text-layer")
      .innerText();
    expect(notesText).toContain("Notes");
    expect(notesText).not.toContain("Notes Summary");
    expect(notesText).toContain("Export check");
    expect(notesText).toContain("Round-trip note body");
    expect(notesText).toContain("marklypdf");
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best effort
    }
  }

  // Cleanup seeded overlays for other tests (fresh contexts anyway, belt & braces).
  await page.evaluate(() => {
    localStorage.removeItem("markly.highlights.v1");
    localStorage.removeItem("markly.markups.v1");
    localStorage.removeItem("markly.notes.v1");
  });
});

test("batch8: large PDF export shows progress", async ({ page }) => {  await page.goto("/");
  await openPdfViaToolbar(page, LARGE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".thumb-item")).toHaveCount(120, { timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export highlighted PDF" }).click();
  // Progress indicator for large PDFs (dialog + determinate bar).
  await expect(page.getByRole("dialog", { name: "Exporting highlighted PDF" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("progressbar", { name: "Export progress" })).toBeVisible({
    timeout: 15_000,
  });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("-annotated.pdf");
});
