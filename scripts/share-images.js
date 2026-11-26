// Link-preview pictures (Jim, 2026-11-25): after `npm run build`, serve dist/ with `vite preview`, open each view in
// src/lib/shareViews.js in headless Chrome (driven over the DevTools protocol; Chrome comes with the GitHub runner),
// screenshot its element to dist/share/<view>.png and point dist/s/<view>/index.html's preview at it. The page
// loads live data from the notify service like any visitor, so the pictures are as fresh as the deploy.
// A view that fails keeps the site icon. Run by deploy.yml; locally: CHROME_PATH=... node scripts/share-images.js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHARE_VIEWS } from "../src/lib/shareViews.js";

const SITE_URL = "https://boerkoel.github.io/OnThursdaysWeFantasy.io/";
const PORT = 4173, DEBUG_PORT = 9335;   // 4173: an origin the notify service allows (CORS)
// SHARE_BASE: picture another copy of the site instead (a local test against the live site).
const BASE = process.env.SHARE_BASE || `http://localhost:${PORT}/OnThursdaysWeFantasy.io/`;
// 800 CSS px wide at 1.5x: 1200 px pictures, cut to at most 4:3 (the top of a tall section).
const WIDTH = 800, SCALE = 1.5, MAX_ASPECT = 0.75, SETTLE_MS = 3500, VIEW_TIMEOUT_MS = 15000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHROMES = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const chromePath = CHROMES.find(p => existsSync(p));
if (!chromePath) { console.warn("share-images: no Chrome found; previews keep the site icon."); process.exit(0); }

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return r; } catch {}
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const children = [];
const stop = () => children.forEach(c => { try { c.kill("SIGKILL"); } catch {} });
process.on("exit", stop);

if (!process.env.SHARE_BASE) children.push(spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" }));
await waitFor(BASE, 30000);
children.push(spawn(chromePath, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${await mkdtemp(join(tmpdir(), "otwf-chrome-"))}`,
  "--no-sandbox", "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" }));
await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30000);
const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === "page");

// A minimal DevTools protocol client.
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1000, deviceScaleFactor: SCALE, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

const rectOf = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const r = el.getBoundingClientRect(); return r.height > 40 ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : null; })()`);

const stamp = Date.now();
await mkdir("dist/share", { recursive: true });
let made = 0;
for (const [view, { hash, shot }] of Object.entries(SHARE_VIEWS)) {
  if (!shot) continue;
  try {
    await send("Page.navigate", { url: `${BASE}?shot=${stamp}-${view}#${hash}` });
    const end = Date.now() + VIEW_TIMEOUT_MS;
    while (Date.now() < end && !(await rectOf(shot).catch(() => null))) await sleep(500);
    await sleep(SETTLE_MS);   // live data, logos and needles settle
    const r = await rectOf(shot);
    if (!r) throw new Error(`no ${shot} on the page`);
    const pad = 14;   // a margin of page background, so headings don't touch the edge
    const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: Math.min(r.h, r.w * MAX_ASPECT) + 2 * pad, scale: 1 };
    const { data } = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    await writeFile(`dist/share/${view}.png`, Buffer.from(data, "base64"));
    const file = `dist/s/${view}/index.html`;
    const w = Math.round(clip.width * SCALE), h = Math.round(clip.height * SCALE);
    const html = (await readFile(file, "utf8"))
      .replace(/<meta property="og:image" content="[^"]*"><!--share-image-->/,
        `<meta property="og:image" content="${SITE_URL}share/${view}.png?v=${stamp}"><meta property="og:image:width" content="${w}"><meta property="og:image:height" content="${h}">`)
      .replace(/<meta name="twitter:card" content="summary"><!--share-card-->/, `<meta name="twitter:card" content="summary_large_image">`);
    await writeFile(file, html);
    made++;
    console.log(`share-images: ${view} (${w}×${h})`);
  } catch (error) {
    console.warn(`share-images: ${view} failed, keeping the icon: ${error.message}`);
  }
}
console.log(`share-images: ${made} pictures.`);
ws.close();
stop();
process.exit(0);
