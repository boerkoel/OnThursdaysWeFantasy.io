import { writeFile, readFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

const matchup = JSON.parse(await readFile("data/current/mMatchup.json", "utf8"));
const scoringPeriodId = Number(matchup.scoringPeriodId || 1);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function hasMatchupDetails(data) {
  return Array.isArray(data?.schedule) &&
    data.schedule.some(g => g?.home?.teamId && g?.away?.teamId);
}

async function fetchLiveBundle() {
  const url = new URL(base);
  url.searchParams.append("view", "mBoxscore");
  url.searchParams.append("view", "mLiveScoring");
  url.searchParams.append("view", "mScoreboard");
  url.searchParams.set("scoringPeriodId", String(scoringPeriodId));

  // ESPN's live views are more reliable when requested together with only
  // scoringPeriodId. Adding matchupPeriodId can return schedule shells
  // without the home/away matchup data we need.
  const combined = await fetchJson(url);

  if (hasMatchupDetails(combined)) {
    return { liveScoring: combined, boxscore: combined, scoreboard: combined, mode: "combined" };
  }

  console.warn("Combined ESPN live response did not contain matchup details; trying individual live views.");

  async function fetchView(view, includeMatchupPeriod = false) {
    const viewUrl = new URL(base);
    viewUrl.searchParams.set("view", view);
    viewUrl.searchParams.set("scoringPeriodId", String(scoringPeriodId));
    if (includeMatchupPeriod) viewUrl.searchParams.set("matchupPeriodId", String(scoringPeriodId));
    return fetchJson(viewUrl);
  }

  const [liveScoring, boxscore, scoreboard] = await Promise.all([
    fetchView("mLiveScoring"),
    fetchView("mBoxscore", true),
    fetchView("mScoreboard")
  ]);

  return { liveScoring, boxscore, scoreboard, mode: "individual" };
}

const { liveScoring, boxscore, scoreboard, mode } = await fetchLiveBundle();

await writeFile("data/current/mLiveScoring.json", JSON.stringify(liveScoring, null, 2) + "\n");
await writeFile("data/current/mBoxscore.json", JSON.stringify(boxscore, null, 2) + "\n");
await writeFile("data/current/mScoreboard.json", JSON.stringify(scoreboard, null, 2) + "\n");

const schedule = liveScoring?.schedule || boxscore?.schedule || scoreboard?.schedule || [];
const detailedMatchups = schedule.filter(g => g?.home?.teamId && g?.away?.teamId).length;
const liveProjections = schedule.reduce((count, g) => {
  const sides = [g?.home, g?.away];
  return count + sides.filter(side =>
    Number.isFinite(Number(side?.totalProjectedPointsLive)) &&
    Number(side.totalProjectedPointsLive) > 0
  ).length;
}, 0);

console.log(`Fetched ESPN live views for scoring period ${scoringPeriodId} using ${mode} request: ${detailedMatchups} detailed matchups, ${liveProjections} live projections.`);
