import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Which code this build is: the commit (live runs rebuild the same commit, so
// it only changes when code or the daily data is pushed). The page compares
// it with the published version.json to notice new code.
// Commit time orders builds, so a live run still deploying the previous
// commit never looks like an update.
const BUILD_ID = process.env.GITHUB_SHA || `dev-${Date.now()}`;
let BUILD_TIME = 0;
try { BUILD_TIME = Number(execSync("git log -1 --format=%ct", { encoding: "utf8" }).trim()) || 0; } catch {}

// The page polls these files for fresh data between page loads, so they must
// be published next to the bundle (the rest of data/ is only imported).
const POLLED_DATA_FILES = ["scoreboard.json", "marquee.json", "live-plays.json", "metadata.json", "guillotine.json", "season-odds.json"];

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
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID, time: BUILD_TIME }) });
    }
  };
}

export default defineConfig({
  base: "/OnThursdaysWeFantasy.io/",
  plugins: [react(), publishPolledData()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __BUILD_TIME__: JSON.stringify(BUILD_TIME) },
});
