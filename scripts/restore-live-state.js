import { readFile, writeFile } from "node:fs/promises";

// Live updates are published (to the notification service, and now and then
// to GitHub Pages) without being committed, so the published copies hold the
// newest live state. Before building or
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

// Live runs publish to the notification service and only redeploy Pages now
// and then, so the service usually has the newest copy. Its files, keyed
// like LIVE_FILES (null if unreachable).
const SERVICE = process.env.NOTIFY_SERVICE || "https://otwf-notify.otwf.workers.dev";
const fetchJson = url => fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } })
  .then(r => r.ok ? r.json() : null).catch(() => null);
const serviceLive = await fetchJson(`${SERVICE}/live?ts=${Date.now()}`);
const serviceArchive = await fetchJson(`${SERVICE}/live/week-archive?ts=${Date.now()}`);
const fromService = {
  "scoreboard.json": serviceLive?.scoreboard, "marquee.json": serviceLive?.marquee, "live-plays.json": serviceLive?.livePlays,
  "guillotine.json": serviceLive?.guillotine, "season-odds.json": serviceLive?.seasonOdds, "week-archive.json": serviceArchive
};

for (const { file, timestamp } of LIVE_FILES) {
  const path = `data/current/${file}`;
  try {
    const local = JSON.parse(await readFile(path, "utf8").catch(() => "{}"));
    const pages = await fetchJson(`${siteUrl}data/current/${file}?ts=${Date.now()}`);
    const service = fromService[file] || null;
    // The newer of the two published copies.
    const published = time(timestamp(service || {})) > time(timestamp(pages || {})) ? service : pages;
    if (!published) throw new Error("no published copy");

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
