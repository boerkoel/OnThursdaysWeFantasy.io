import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { SHARE_VIEWS } from "./src/lib/shareViews.js";

// Which code this build is: the commit (live runs rebuild the same commit, so
// it only changes when code or the daily data is pushed). The page compares
// it with the published version.json to notice new code.
// Commit time orders builds, so a live run still deploying the previous
// commit never looks like an update.
// The commit actually built (a live run checks out the latest main, which can
// be newer than the commit that queued it).
let BUILD_ID = process.env.GITHUB_SHA || `dev-${Date.now()}`;
try { BUILD_ID = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || BUILD_ID; } catch {}
let BUILD_TIME = 0;
try { BUILD_TIME = Number(execSync("git log -1 --format=%ct", { encoding: "utf8" }).trim()) || 0; } catch {}

// Link-preview pages, one per view in src/lib/shareViews.js: /s/<view>/ carries the view's name in its preview tags
// (crawlers never see the part after #, so the hash alone can't do this) and forwards to the site, keeping any
// #section from the link. The picture starts as the site icon; scripts/share-images.js swaps in a screenshot of
// the view after the build (the marked og:image lines), so a failed screenshot still leaves a working preview.
const SITE_URL = "https://boerkoel.github.io/OnThursdaysWeFantasy.io/";
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function sharePage({ title, hash }) {
  const full = escapeHtml(`${title} · On Thursdays We Fantasy`);
  const to = `${SITE_URL}#${hash}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<meta name="description" content="The Officially Unofficial League Record Book">
<meta property="og:site_name" content="On Thursdays We Fantasy">
<meta property="og:title" content="${full}">
<meta property="og:description" content="The Officially Unofficial League Record Book">
<meta property="og:image" content="${SITE_URL}icons/icon-512.png"><!--share-image-->
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary"><!--share-card-->
<script>location.replace(${JSON.stringify(SITE_URL)} + (location.hash || ${JSON.stringify("#" + hash)}))</script>
<noscript><meta http-equiv="refresh" content="0; url=${to}"></noscript>
</head><body style="background:#10110f;color:#f7f7f2;font-family:system-ui,sans-serif"><a style="color:#b8c69b" href="${to}">${full}</a></body></html>
`;
}
function publishSharePages() {
  return {
    name: "publish-share-pages",
    generateBundle() {
      for (const [view, spec] of Object.entries(SHARE_VIEWS)) {
        this.emitFile({ type: "asset", fileName: `s/${view}/index.html`, source: sharePage(spec) });
      }
    }
  };
}

// The page polls these files for fresh data between page loads, so they must
// be published next to the bundle (the rest of data/ is only imported).
const POLLED_DATA_FILES = ["scoreboard.json", "marquee.json", "live-plays.json", "metadata.json", "guillotine.json", "season-odds.json"];
// Published next to the bundle but not part of live.json (loaded on demand).
const ON_DEMAND_DATA_FILES = ["week-archive.json"];

// The page polls live.json (everything that changes during games, in one
// request); the individual files are what restore-live-state.js reads back.
function publishPolledData() {
  return {
    name: "publish-polled-data",
    async generateBundle() {
      const contents = {};
      for (const file of POLLED_DATA_FILES) {
        contents[file] = await readFile(`data/current/${file}`, "utf8");
        this.emitFile({ type: "asset", fileName: `data/current/${file}`, source: contents[file] });
      }
      const live = {
        scoreboard: JSON.parse(contents["scoreboard.json"]),
        marquee: JSON.parse(contents["marquee.json"]),
        livePlays: JSON.parse(contents["live-plays.json"]),
        guillotine: JSON.parse(contents["guillotine.json"]),
        seasonOdds: JSON.parse(contents["season-odds.json"])
      };
      this.emitFile({ type: "asset", fileName: "data/current/live.json", source: JSON.stringify(live) });
      for (const file of ON_DEMAND_DATA_FILES) {
        const source = await readFile(`data/current/${file}`, "utf8").catch(() => null);
        if (source) this.emitFile({ type: "asset", fileName: `data/current/${file}`, source });
      }
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID, time: BUILD_TIME }) });
    }
  };
}

export default defineConfig({
  base: "/OnThursdaysWeFantasy.io/",
  plugins: [react(), publishPolledData(), publishSharePages()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __BUILD_TIME__: JSON.stringify(BUILD_TIME) },
});
