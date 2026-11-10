import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");

async function openViewer(page: Page) {
  await page.goto("/");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-text-layer span").first()).toBeAttached({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
}

test("text layer span geometry matches PDF text metrics", async ({ page }) => {
  await openViewer(page);

  const measured = await page.evaluate(() => {
    const pageEl = document.querySelector(
      '.pdf-page[data-page-number="1"]',
    ) as HTMLElement | null;
    const layer = pageEl?.querySelector(
      ":scope .pdf-text-layer",
    ) as HTMLElement | null;
    if (!pageEl || !layer) return null;

    const span = Array.from(layer.querySelectorAll("span")).find((el) =>
      (el.textContent ?? "").startsWith("Line 01"),
    );
    if (!span) return null;

    const rect = span.getBoundingClientRect();
    const style = getComputedStyle(span);
    const scale = Number.parseFloat(
      getComputedStyle(layer).getPropertyValue("--total-scale-factor"),
    );
    return {
      text: span.textContent ?? "",
      width: rect.width,
      fontSize: Number.parseFloat(style.fontSize),
      scale,
      divIndex: span.getAttribute("data-div-index"),
    };
  });

  expect(measured, "Line 01 span is present").not.toBeNull();
  expect(measured!.scale).toBeGreaterThan(0);
  expect(measured!.divIndex).not.toBeNull();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const expectedWidth =
    font.widthOfTextAtSize(measured!.text, 12) * measured!.scale;

  expect(measured!.fontSize).toBeCloseTo(12 * measured!.scale, 0);
  expect(
    Math.abs(measured!.width - expectedWidth),
    "text span width matches PDF text width",
  ).toBeLessThanOrEqual(Math.max(1.5, expectedWidth * 0.02));
});
