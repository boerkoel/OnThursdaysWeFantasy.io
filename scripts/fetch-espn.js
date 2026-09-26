import { mkdir, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

const views = ["mSettings", "mTeam", "mRoster", "mMatchup", "mScoreboard", "mLiveScoring", "mDraftDetail"];

const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) {
  throw new Error("Missing ESPN_S2 or ESPN_SWID GitHub Actions secrets.");
}

async function fetchView(view, scoringPeriodId = null) {
  const url = new URL(base);
  url.searchParams.set("view", view);
  if (scoringPeriodId != null) url.searchParams.set("scoringPeriodId", String(scoringPeriodId));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`
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

// Keep week-specific roster snapshots so player awards can use actual weekly
// fantasy scores from completed weeks, rather than only the current roster view.
const currentScoringPeriod = Number(results.mMatchup?.scoringPeriodId || 1);
for (let week = 1; week <= currentScoringPeriod; week++) {
  console.log(`Fetching historical roster/boxscore data for week ${week}...`);
  const weeklyRoster = await fetchView("mRoster", week);
  const weeklyBoxscore = await fetchView("mBoxscore", week);
  await writeFile(
    `data/current/mRoster-week-${week}.json`,
    JSON.stringify(weeklyRoster, null, 2) + "\n"
  );
  await writeFile(
    `data/current/mBoxscore-week-${week}.json`,
    JSON.stringify(weeklyBoxscore, null, 2) + "\n"
  );
}

await writeFile(
  "data/current/metadata.json",
  JSON.stringify({ season, leagueId, fetchedAt, views }, null, 2) + "\n"
);

console.log(`Fetched ${views.length} ESPN views for league ${leagueId}.`);
