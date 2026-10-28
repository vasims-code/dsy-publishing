/**
 * Builds the two things the browser takes from ../aem-toolkit:
 *
 *   dist/engine.js                the content runtime + feature workers, one script,
 *                                 injected into author tabs
 *   dist/main.mjs                 the browser's main process, with the toolkit modules it
 *                                 uses bundled in - an installed app cannot reach ../aem-toolkit
 *   dist/preload-ui.cjs, icon.png copied as they are
 *   renderer/src/engine/toolkit.css   the extension panel's stylesheet, scoped to
 *                                 .tk and coloured with the browser's design tokens,
 *                                 for the result screens the features draw themselves
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolkit = path.join(root, "..", "aem-toolkit", "src");

await build({
  entryPoints: [path.join(root, "engine", "tab-entry.js")],
  outfile: path.join(root, "dist", "engine.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  legalComments: "none",
  logLevel: "warning",
});

await build({
  entryPoints: [path.join(root, "electron", "main.mjs")],
  outfile: path.join(root, "dist", "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["electron"],
  legalComments: "none",
  logLevel: "warning",
});
fs.copyFileSync(path.join(root, "electron", "preload-ui.cjs"), path.join(root, "dist", "preload-ui.cjs"));
if (fs.existsSync(path.join(root, "build", "icon.png"))) {
  fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(root, "dist", "icon.png"));
}

/* ---------- stylesheet ---------- */

const css = fs.readFileSync(path.join(toolkit, "panel", "panel.css"), "utf8");

// Remove one balanced { } block starting at index i (the selector's first char).
function cutBlock(text, i) {
  let depth = 0;
  for (let j = text.indexOf("{", i); j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return text.slice(0, i) + text.slice(j + 1);
  }
  return text;
}

// The text inside one balanced { } block whose opening brace is at or after index i.
function blockBody(text, i) {
  const open = text.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return text.slice(open + 1, j);
  }
  return "";
}

let body = css;
/* Colour variables. The main palette (the block defining --bg) gives way to the browser's
 * design tokens below; any other block - the CRXDE tree's colours, say - is kept, as .tk
 * for the light theme and .dark .tk for the dark one, so it follows the browser's switch
 * rather than the operating system's. */
const kept = { light: [], dark: [] };
const DARK_ROOT = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root/;
const ROOT = /:root\s*\{/;
for (const [re, theme] of [[DARK_ROOT, "dark"], [ROOT, "light"]]) {
  let m;
  while ((m = re.exec(body))) {
    const vars = theme === "dark" ? blockBody(body, body.indexOf(":root", m.index)) : blockBody(body, m.index);
    if (!/--bg\s*:/.test(vars)) kept[theme].push(vars.replace(/color-scheme:[^;]*;/g, "").trim());
    body = cutBlock(body, m.index);
  }
}
// Page-level rules: the browser has its own page.
for (const re of [/(^|\n)\s*html\s*\{/, /(^|\n)\s*body\s*\{/]) {
  let m;
  while ((m = re.exec(body))) body = cutBlock(body, m.index + (m[1] ? m[1].length : 0));
}
// @keyframes cannot sit inside a nested style rule.
const keyframes = [];
body = body.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, (k) => {
  keyframes.push(k);
  return "";
});

const tokens = `
.tk {
  --bg: hsl(var(--panel));
  --surface: hsl(var(--card));
  --sunken: hsl(var(--muted));
  --fg: hsl(var(--foreground));
  --fg-muted: hsl(var(--muted-foreground));
  --fg-faint: hsl(var(--muted-foreground) / 0.75);
  --line: hsl(var(--border));
  --line-strong: hsl(var(--muted-foreground) / 0.45);
  --accent: hsl(var(--primary));
  --accent-hover: hsl(var(--primary) / 0.85);
  --accent-fg: hsl(var(--primary-foreground));
  --accent-soft: hsl(var(--primary) / 0.15);
  --accent-softer: hsl(var(--primary) / 0.07);
  --accent-line: hsl(var(--primary) / 0.45);
  --ok: hsl(var(--status-green));
  --ok-bg: hsl(var(--status-green) / 0.12);
  --warn: hsl(var(--status-amber));
  --warn-bg: hsl(var(--status-amber) / 0.12);
  --warn-line: hsl(var(--status-amber) / 0.4);
  --err: hsl(var(--status-red));
  --err-bg: hsl(var(--status-red) / 0.12);
  --err-line: hsl(var(--status-red) / 0.4);
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 10px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  --shadow-hover: 0 4px 12px rgb(0 0 0 / 0.12);
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg-raised: var(--surface);
  --bg-sunken: var(--sunken);
  color: var(--fg);
  font-size: 13px;
  line-height: 1.45;
}
`;

const out =
  "/* Generated by scripts/build-engine.mjs from aem-toolkit/src/panel/panel.css - do not edit. */\n" +
  tokens +
  (kept.light.length ? `\n.tk {\n${kept.light.join("\n")}\n}\n` : "") +
  (kept.dark.length ? `\n.dark .tk {\n${kept.dark.join("\n")}\n}\n` : "") +
  "\n.tk {\n" +
  body +
  "\n}\n" +
  keyframes.join("\n") +
  "\n";
fs.mkdirSync(path.join(root, "renderer", "src", "engine"), { recursive: true });
fs.writeFileSync(path.join(root, "renderer", "src", "engine", "toolkit.css"), out);
console.log("main.mjs, engine.js and toolkit.css built");
