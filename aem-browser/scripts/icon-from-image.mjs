/**
 * Turns a square icon image with a solid backdrop (as AI image tools make them) into the
 * app icon: finds the teal rounded tile, cuts it out along its own rounded corners, and
 * centres it on a transparent 1024px square - build/icon.png. Also writes a small copy
 * for the new tab page.
 *
 *   npx electron scripts/icon-from-image.mjs build/icon-source.jpg
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.resolve(root, process.argv.find((a) => /\.(jpe?g|png|webp)$/i.test(a)) || "build/icon-source.jpg");
const OUT = 1024;
const MARGIN = 0.03; // of the canvas, each side - Windows draws icons nearly edge to edge

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html,<html><body></body></html>");
  const src = `data:image/${path.extname(input).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(input).toString("base64")}`;

  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(src)};
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    // The tile is teal: green well above red. The backdrop is a neutral grey.
    const teal = (i) => d[i + 1] > 70 && d[i + 1] - d[i] > 40;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
      if (teal((y * w + px) * 4)) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    // Corner radius from the top-left corner's diagonal: a circle of radius R leaves a gap of R(1 - 1/sqrt 2) there.
    let t = 0;
    while (t < (maxX - minX) / 2 && !teal(((minY + t) * w + (minX + t)) * 4)) t++;
    const R = t / (1 - Math.SQRT1_2);

    const tileW = maxX - minX + 1, tileH = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = out.height = ${OUT};
    const o = out.getContext("2d");
    const size = ${OUT} * (1 - 2 * ${MARGIN});
    const k = size / Math.max(tileW, tileH);
    const ox = (${OUT} - tileW * k) / 2, oy = (${OUT} - tileH * k) / 2;
    // A hair inside the edge, so no backdrop shows through along the curve.
    const inset = 2.5 * k;
    o.save();
    o.beginPath();
    o.roundRect(ox + inset, oy + inset, tileW * k - 2 * inset, tileH * k - 2 * inset, Math.max(0, R * k - inset));
    o.clip();
    o.imageSmoothingQuality = "high";
    o.drawImage(img, minX, minY, tileW, tileH, ox, oy, tileW * k, tileH * k);
    o.restore();

    const small = document.createElement("canvas");
    small.width = small.height = 128;
    const s = small.getContext("2d");
    s.imageSmoothingQuality = "high";
    s.drawImage(out, 0, 0, 128, 128);

    return { w, h, tile: [minX, minY, maxX, maxY], radius: Math.round(R), big: out.toDataURL("image/png"), small: small.toDataURL("image/png") };
  })()`);

  const save = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  save(path.join(root, "build", "icon.png"), result.big);
  fs.mkdirSync(path.join(root, "renderer", "src", "assets"), { recursive: true });
  save(path.join(root, "renderer", "src", "assets", "dsy-icon.png"), result.small);
  console.log(`source ${result.w}x${result.h}, tile ${result.tile.join(",")}, corner radius ${result.radius}px -> build/icon.png, renderer/src/assets/dsy-icon.png`);
  app.quit();
});
