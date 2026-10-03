import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/markly-5page.pdf");

test("probe natural scroll", async ({ page }) => {
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

  // Scroll like a user (real wheel gesture), no programmatic scrolling.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(600);

  const drag = async (line: string, dx: number) => {
    const p = (await page.evaluate(([substr, d]) => {
      const pg = document.querySelector('.pdf-page[data-page-number="1"]');
      const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])] as HTMLElement[];
      const el = spans.find((s) => (s.textContent ?? "").includes(substr))!;
      const b = el.getBoundingClientRect();
      return { x: b.x + d, y: b.y + b.height / 2 };
    }, [line, dx] as const)) as { x: number; y: number };
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 80, p.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    const tb = await page.locator(".hl-toolbar").count();
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      document.querySelectorAll(".hl-toolbar").forEach((t) => t.remove());
    });
    await page.waitForTimeout(150);
    return { sel: sel.slice(0, 24), toolbar: tb };
  };

  console.log("Line30 x+10:", JSON.stringify(await drag("Line 30", 10)));
  console.log("Line30 x+30:", JSON.stringify(await drag("Line 30", 30)));

  const caretMap = await page.evaluate(() => {
    const pg = document.querySelector('.pdf-page[data-page-number="1"]');
    const spans = [...(pg?.querySelectorAll(".pdf-text-layer span") ?? [])] as HTMLElement[];
    const el = spans.find((s) => (s.textContent ?? "").includes("Line 30"))!;
    const text = el.firstChild!;
    const out: Array<{ off: number; x: number }> = [];
    for (let off = 0; off <= 8; off++) {
      const r = document.createRange();
      r.setStart(text, off);
      r.setEnd(text, off);
      const rects = r.getClientRects();
      const rect = rects[0];
      out.push({ off, x: rect ? Math.round(rect.left * 100) / 100 : -1 });
    }
    return { spanX: el.getBoundingClientRect().x, map: out, textStart: (el.textContent ?? "").slice(0, 12) };
  });
  console.log("caretMap:", JSON.stringify(caretMap));
});
