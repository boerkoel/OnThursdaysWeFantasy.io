import { mkdir, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

const views = ["mSettings", "mTeam", "mRoster", "mMatchup", "mScoreboard"];

async function fetchView(view) {
  const url = new URL(base);
  url.searchParams.set("view", view);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN ${view} request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

await mkdir("data/current", { recursive: true });

const fetchedAt = new Date().toISOString();
const results = {};

for (const view of views) {
  console.log(`Fetching ${view}...`);
  results[view] = await fetchView(view);
  await writeFile(
    `data/current/${view}.json`,
    JSON.stringify(results[view], null, 2) + "\n"
  );
}

await writeFile(
  "data/current/metadata.json",
  JSON.stringify({ season, leagueId, fetchedAt, views }, null, 2) + "\n"
);

console.log(`Fetched ${views.length} ESPN views for league ${leagueId}.`);
