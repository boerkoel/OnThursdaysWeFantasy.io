import { writeFile, readFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

const matchup = JSON.parse(await readFile("data/current/mMatchup.json", "utf8"));
const scoringPeriodId = Number(matchup.scoringPeriodId || 1);

async function fetchView(view, { matchupPeriod = false } = {}) {
  const url = new URL(base);
  url.searchParams.set("view", view);
  url.searchParams.set("scoringPeriodId", String(scoringPeriodId));
  if (matchupPeriod) url.searchParams.set("matchupPeriodId", String(scoringPeriodId));

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

// Fetch each live view separately. ESPN's combined-view response can merge
// schedule fields in ways that obscure the live totals, so keep each view's
// response intact and use the view that is designed for that purpose.
const [liveScoring, boxscore, scoreboard] = await Promise.all([
  fetchView("mLiveScoring"),
  fetchView("mBoxscore", { matchupPeriod: true }),
  fetchView("mScoreboard")
]);

await writeFile("data/current/mLiveScoring.json", JSON.stringify(liveScoring, null, 2) + "\n");
await writeFile("data/current/mBoxscore.json", JSON.stringify(boxscore, null, 2) + "\n");
await writeFile("data/current/mScoreboard.json", JSON.stringify(scoreboard, null, 2) + "\n");

console.log(`Fetched separate mLiveScoring, mBoxscore, and mScoreboard responses for scoring period ${scoringPeriodId}.`);
