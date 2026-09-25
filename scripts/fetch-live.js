import { readFile, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

const matchup = JSON.parse(await readFile("data/current/mMatchup.json", "utf8"));
const scoringPeriodId = Number(matchup.scoringPeriodId || 1);

async function fetchViews(views) {
  const url = new URL(base);
  for (const view of views) url.searchParams.append("view", view);
  url.searchParams.set("scoringPeriodId", String(scoringPeriodId));
  url.searchParams.set("matchupPeriodId", String(scoringPeriodId));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN live scoring request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

const data = await fetchViews(["mBoxscore", "mLiveScoring", "mScoreboard"]);

await writeFile("data/current/mLiveScoring.json", JSON.stringify(data, null, 2) + "\n");
await writeFile("data/current/mBoxscore.json", JSON.stringify(data, null, 2) + "\n");
await writeFile("data/current/mScoreboard.json", JSON.stringify(data, null, 2) + "\n");

console.log(`Fetched mBoxscore + mLiveScoring + mScoreboard for scoring period ${scoringPeriodId}.`);