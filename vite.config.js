import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The page polls these files for fresh data between page loads, so they must
// be published next to the bundle (the rest of data/ is only imported).
const POLLED_DATA_FILES = ["scoreboard.json", "marquee.json", "live-plays.json", "metadata.json", "guillotine.json"];

function publishPolledData() {
  return {
    name: "publish-polled-data",
    async generateBundle() {
      for (const file of POLLED_DATA_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `data/current/${file}`,
          source: await readFile(`data/current/${file}`, "utf8")
        });
      }
    }
  };
}

export default defineConfig({
  base: "/OnThursdaysWeFantasy.io/",
  plugins: [react(), publishPolledData()],
});
