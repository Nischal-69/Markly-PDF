/**
 * Batch 10 — generates performance fixtures with Node + pdf-lib:
 *
 * - markly-images.pdf: pages with embedded photographic-style (noise)
 *   PNGs plus selectable caption text. Exercises image decoding, large
 *   file-size loading (~MBs), rendering, and text selection.
 *
 * Deterministic (seeded PRNG) so the fixture is stable across runs.
 * Run: `node tests/make_big_fixtures.mjs`
 */
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "fixtures", "markly-images.pdf");

// --- deterministic PRNG (mulberry32) ---------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- minimal PNG encoder (8-bit truecolor, non-interlaced) ------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 0);
  return Buffer.concat([len, typeBytes, Buffer.from(data), crc]);
}

/** Random-noise RGB image → PNG bytes (poorly compressible, like a photo). */
function noisePng(width, height, rand) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  // Base hue drifts slowly across the image so pages look distinct while
  // staying incompressible (per-pixel jitter defeats deflate matching).
  let r = Math.floor(rand() * 256);
  let g = Math.floor(rand() * 256);
  let b = Math.floor(rand() * 256);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type 0 (None)
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      r = Math.max(0, Math.min(255, r + Math.floor(rand() * 61) - 30));
      g = Math.max(0, Math.min(255, g + Math.floor(rand() * 61) - 30));
      b = Math.max(0, Math.min(255, b + Math.floor(rand() * 61) - 30));
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- document -----------------------------------------------------------------

const PAGE_W = 595;
const PAGE_H = 842;
const NUM_PAGES = 6;
const IMG_W = 240;
const IMG_H = 180;

const doc = await PDFDocument.create();
const helvetica = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const rand = mulberry32(20261005);

for (let p = 1; p <= NUM_PAGES; p += 1) {
  const page = doc.addPage([PAGE_W, PAGE_H]);

  page.drawText(`Gallery page ${p} — image rendering test`, {
    x: 56,
    y: PAGE_H - 70,
    size: 18,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const caption =
    `Figure ${p}A (left) and Figure ${p}B (right) are embedded raster images. ` +
    `The text on this page stays selectable while the images decode. ` +
    `Markly PDF must render, scroll, zoom and search this document smoothly.`;
  const words = caption.split(" ");
  let line = "";
  let y = PAGE_H - 100;
  const lines = [];
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > 78) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  for (const l of lines) {
    page.drawText(l, { x: 56, y, size: 10.5, font: helvetica, color: rgb(0.15, 0.15, 0.15) });
    y -= 15;
  }

  const imgY = y - IMG_H - 24;
  const left = await doc.embedPng(noisePng(IMG_W, IMG_H, rand));
  const right = await doc.embedPng(noisePng(IMG_W, IMG_H, rand));
  page.drawImage(left, { x: 40, y: imgY, width: IMG_W, height: IMG_H });
  page.drawImage(right, { x: 40 + IMG_W + 35, y: imgY, width: IMG_W, height: IMG_H });

  page.drawText(`Figure ${p}A — embedded PNG photograph (left)`, {
    x: 40, y: imgY - 18, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText(`Figure ${p}B — embedded PNG photograph (right)`, {
    x: 40 + IMG_W + 35, y: imgY - 18, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3),
  });

  // Dense selectable body text below the figures (search + text layer load).
  let ty = imgY - 48;
  page.drawText(`Notes on gallery page ${p}:`, {
    x: 56, y: ty, size: 12, font: bold, color: rgb(0.1, 0.1, 0.1),
  });
  ty -= 18;
  for (let lineNo = 1; lineNo <= 22; lineNo += 1) {
    page.drawText(
      `Line ${String(lineNo).padStart(2, "0")}: sample body text for selection, zoom and scroll testing (page ${p}).`,
      { x: 56, y: ty, size: 9.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) },
    );
    ty -= 14;
  }
}

const bytes = await doc.save();
await fs.writeFile(OUT, bytes);
console.log(`wrote ${OUT} (${bytes.length} bytes, ${NUM_PAGES} pages)`);
