import { appendFile, readFile } from "node:fs/promises";

// Publishes this run's live data to the notification service, which serves
// it to the app (GET /live) and sends push alerts from it. Each file goes as
// JSON text so the service can store it without parsing. Writes
// published=true|false to $GITHUB_OUTPUT; the workflow redeploys GitHub Pages
// when publishing fails (and every so often as a fallback).
const SERVICE = process.env.NOTIFY_SERVICE || "https://otwf-notify.otwf.workers.dev";
const token = process.env.LIVE_PUBLISH_TOKEN;
const FILES = { scoreboard: "scoreboard.json", marquee: "marquee.json", livePlays: "live-plays.json",
  guillotine: "guillotine.json", seasonOdds: "season-odds.json", weekArchive: "week-archive.json" };

let published = false;
try {
  if (!token) throw new Error("LIVE_PUBLISH_TOKEN is not set");
  const files = {};
  for (const [name, file] of Object.entries(FILES)) {
    const text = await readFile(`data/current/${file}`, "utf8").catch(() => null);
    if (text) files[name] = JSON.stringify(JSON.parse(text));   // compact
  }
  const scoreboardUpdated = JSON.parse(files.scoreboard || "{}").lastUpdated;
  const response = await fetch(`${SERVICE}/live`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scoreboardUpdated, files })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${result.error || "no details"}`);
  published = Boolean(result.stored) || result.reason === "older";
  console.log(`Live data ${result.stored ? "published" : "not stored (" + result.reason + ")"}: scoreboard ${scoreboardUpdated}.`);
} catch (error) {
  console.log(`::warning title=Live publish::${error.message}; GitHub Pages will be redeployed instead.`);
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${published}\n`);
