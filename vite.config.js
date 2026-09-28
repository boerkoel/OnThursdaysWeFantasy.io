import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The page polls these files for fresh data between page loads, so they must
// be published next to the bundle (the rest of data/ is only imported).
const POLLED_DATA_FILES = ["scoreboard.json", "marquee.json", "live-plays.json", "metadata.json", "guillotine.json"];

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
        guillotine: JSON.parse(contents["guillotine.json"])
      };
      this.emitFile({ type: "asset", fileName: "data/current/live.json", source: JSON.stringify(live) });
    }
  };
}

export default defineConfig({
  base: "/OnThursdaysWeFantasy.io/",
  plugins: [react(), publishPolledData()],
});
