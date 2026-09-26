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

const now = new Date();
const [today, tomorrow] = await Promise.all([
  fetchSchedule(now),
  fetchSchedule(new Date(now.getTime() + 86400000))
]);

const kickoffs = [...(today.events || []), ...(tomorrow.events || [])]
  .map(event => new Date(event.date))
  .filter(date => Number.isFinite(date.getTime()));

const active = kickoffs.some(kickoff => {
  const start = kickoff.getTime();
  return Date.now() >= start - 15 * 60 * 1000 &&
    Date.now() <= start + 5 * 60 * 60 * 1000;
});

const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error("GITHUB_OUTPUT is not available.");
await appendFile(output, `active=${active ? "true" : "false"}\n`);
console.log(active ? "NFL live window is active." : "No NFL game is within the live-update window.");
