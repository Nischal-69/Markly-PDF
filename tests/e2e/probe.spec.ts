import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");

test("probe drag variants", async ({ page }) => {
  await page.goto("/");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open PDF" }).first().click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await expect(page.getByRole("document")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  const getRect = () =>
    page.evaluate(() => {
      const pg = document.querySelector('.pdf-page[data-page-number="1"]');
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])] as HTMLElement[];
      const el = spans.find((s) => (s.textContent ?? "").includes("Line 30"))!;
      el.scrollIntoView({ block: "center" });
      return new Promise((resolve) => {
        setTimeout(() => {
          const r = el.getBoundingClientRect();
          resolve({ x: r.x, y: r.y, width: r.width, height: r.height });
        }, 350);
      });
    });

  const drag = async (fromX: number, toX: number) => {
    const r = (await getRect()) as { x: number; y: number; width: number; height: number };
    const y = r.y + r.height / 2;
    await page.mouse.move(r.x + fromX, y);
    await page.mouse.down();
    await page.mouse.move(r.x + toX, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({
      selText: window.getSelection()?.toString(),
      toolbar: document.querySelectorAll(".hl-toolbar").length,
    }));
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(200);
    return st;
  };

  console.log("A start30 end160:", JSON.stringify(await drag(30, 160)));
  console.log("B start10 end200:", JSON.stringify(await drag(10, 200)));
  console.log("C start10 end160:", JSON.stringify(await drag(10, 160)));
  console.log("D start30 end200:", JSON.stringify(await drag(30, 200)));
});
