import { readFile, writeFile } from "node:fs/promises";

// Live updates are deployed straight to GitHub Pages without being committed,
// so the published site holds the newest live state. Before building or
// updating, replace each local live file with the published copy when that
// copy is newer. Committed data (from the daily ESPN update) wins otherwise.
const siteUrl = (process.env.PAGES_URL || "https://boerkoel.github.io/OnThursdaysWeFantasy.io/").replace(/\/?$/, "/");

const LIVE_FILES = [
  { file: "scoreboard.json", timestamp: data => data.lastUpdated },
  { file: "marquee.json", timestamp: data => data.lastUpdated },
  { file: "live-plays.json", timestamp: data => data.updatedAt },
  { file: "guillotine.json", timestamp: data => data.lastUpdated },
  { file: "season-odds.json", timestamp: data => data.lastUpdated },
  { file: "week-archive.json", timestamp: data => data.updatedAt }
];

const time = value => {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
};

for (const { file, timestamp } of LIVE_FILES) {
  const path = `data/current/${file}`;
  try {
    const local = JSON.parse(await readFile(path, "utf8").catch(() => "{}"));
    const response = await fetch(`${siteUrl}data/current/${file}?ts=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const published = await response.json();

    if (time(timestamp(published)) > time(timestamp(local))) {
      await writeFile(path, JSON.stringify(published, null, 2) + "\n");
      console.log(`${file}: using published copy (${timestamp(published)}).`);
    } else {
      console.log(`${file}: local copy is current (${timestamp(local) || "no timestamp"}).`);
    }
  } catch (error) {
    // Never fail the run over this; the committed copy is a fine fallback.
    console.warn(`${file}: could not restore published copy (${error.message}).`);
  }
}
