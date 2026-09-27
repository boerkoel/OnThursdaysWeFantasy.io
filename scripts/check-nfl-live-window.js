import { appendFile } from "node:fs/promises";

async function fetchSchedule(date) {
  const dateString = date.toISOString().slice(0, 10).replace(/-/g, "");
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateString}`,
    { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } }
  );
  if (!response.ok) throw new Error(`NFL schedule request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

// ESPN's ?dates= filter uses US Eastern dates, while toISOString() is UTC.
// Primetime kickoffs (after 00:00 UTC) belong to the previous Eastern date,
// so include yesterday to keep TNF/SNF/MNF inside the window.
const now = new Date();
const schedules = await Promise.all(
  [-1, 0, 1].map(offset => fetchSchedule(new Date(now.getTime() + offset * 86400000)))
);

const kickoffs = schedules.flatMap(schedule => schedule.events || [])
  .map(event => new Date(event.date))
  .filter(date => Number.isFinite(date.getTime()));

const WINDOW_BEFORE_KICKOFF = 15 * 60 * 1000;
const WINDOW_AFTER_KICKOFF = 5 * 60 * 60 * 1000;

const active = kickoffs.some(kickoff => {
  const start = kickoff.getTime();
  return Date.now() >= start - WINDOW_BEFORE_KICKOFF &&
    Date.now() <= start + WINDOW_AFTER_KICKOFF;
});

// Seconds until the next live window opens, so the self-scheduling live
// workflow can sleep until then. Empty when no upcoming kickoff was found.
const nextWindowStarts = kickoffs
  .map(kickoff => kickoff.getTime() - WINDOW_BEFORE_KICKOFF)
  .filter(start => start > Date.now());
const nextWindowIn = nextWindowStarts.length
  ? Math.ceil((Math.min(...nextWindowStarts) - Date.now()) / 1000)
  : "";

const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error("GITHUB_OUTPUT is not available.");
await appendFile(output, `active=${active ? "true" : "false"}\nnext_window_in=${nextWindowIn}\n`);
console.log(active ? "NFL live window is active." : "No NFL game is within the live-update window.");
if (nextWindowIn !== "") console.log(`Next live window opens in ${Math.round(nextWindowIn / 60)} minutes.`);
