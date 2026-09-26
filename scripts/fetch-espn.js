import { mkdir, readFile, writeFile } from "node:fs/promises";

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

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function extractFantasyProsEcrData(html) {
  const match = html.match(/(?:var|let|const)\\s+ecrData\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;?/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseFantasyProsTable(html) {
  const rankings = [];
  const rowPattern = /<tr[^>]*class=["'][^"']*player-row[^"']*["'][^>]*>([\\s\\S]*?)<\\/tr>/gi;

  for (const rowMatch of html.matchAll(rowPattern)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\\s\\S]*?)<\\/td>/gi)].map(m =>
      decodeHtml(m[1].replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim())
    );
    if (cells.length < 3) continue;

    const rank = Number(cells[0]);
    const playerCell = cells[2] || "";
    const nameMatch = playerCell.match(/^(.+?)\\s*\\(([A-Z]{2,3})\\)$/);
    const name = (nameMatch ? nameMatch[1] : playerCell).trim();
    const team = nameMatch ? nameMatch[2] : "";

    if (Number.isFinite(rank) && rank > 0 && name && !rankings.some(p => p.rank === rank)) {
      rankings.push({ rank, name, team });
    }
  }

  return rankings;
}

async function fetchFantasyProsRosPpr() {
  const url = "https://www.fantasypros.com/nfl/rankings/?scoring=PPR&type=ros";
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; OnThursdaysWeFantasy/1.0)"
      }
    });
    if (!response.ok) throw new Error(`FantasyPros request failed: ${response.status} ${response.statusText}`);

    const html = await response.text();
    const ecrData = extractFantasyProsEcrData(html);
    let rankings = [];

    if (ecrData?.players && Array.isArray(ecrData.players)) {
      rankings = ecrData.players
        .map(player => ({
          rank: Number(player.rank_ecr ?? player.rank ?? player.ecr),
          name: player.player_name ?? player.name,
          team: player.player_team_id ?? player.team ?? "",
          position: player.player_position_id ?? player.position ?? ""
        }))
        .filter(player => Number.isFinite(player.rank) && player.rank > 0 && player.name);
    }

    if (rankings.length < 200) {
      rankings = parseFantasyProsTable(html);
    }

    const uniqueRankings = [];
    const seenRanks = new Set();
    for (const player of rankings.sort((a, b) => a.rank - b.rank)) {
      if (seenRanks.has(player.rank)) continue;
      seenRanks.add(player.rank);
      uniqueRankings.push(player);
    }

    if (uniqueRankings.length < 200) {
      throw new Error(`FantasyPros parser found only ${uniqueRankings.length} rankings; refusing to replace the previous dataset.`);
    }

    await writeFile(
      "data/current/fantasypros-ros-ppr.json",
      JSON.stringify({
        source: "FantasyPros",
        rankingType: "Rest of Season",
        scoring: "PPR",
        fetchedAt: new Date().toISOString(),
        rankings: uniqueRankings
      }, null, 2) + "\\n"
    );
    console.log(`Fetched ${uniqueRankings.length} FantasyPros ROS PPR rankings.`);
  } catch (error) {
    console.warn(`FantasyPros ROS PPR fetch skipped: ${error.message}`);
    try {
      await readFile("data/current/fantasypros-ros-ppr.json", "utf8");
      console.log("Keeping the previous FantasyPros ROS PPR rankings.");
    } catch {
      console.warn("No previous FantasyPros ROS PPR rankings are available.");
    }
  }
}

await mkdir("data/current", { recursive: true });

const fetchedAt = new Date().toISOString();
const results = {};

for (const view of views) {
  console.log(`Fetching ${view}...`);
  results[view] = await fetchView(view);
  await writeFile(
    `data/current/${view}.json`,
    JSON.stringify(results[view], null, 2) + "\\n"
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
    JSON.stringify(weeklyRoster, null, 2) + "\\n"
  );
  await writeFile(
    `data/current/mBoxscore-week-${week}.json`,
    JSON.stringify(weeklyBoxscore, null, 2) + "\\n"
  );
}

await writeFile(
  "data/current/metadata.json",
  JSON.stringify({ season, leagueId, fetchedAt, views }, null, 2) + "\\n"
);

await fetchFantasyProsRosPpr();

console.log(`Fetched ${views.length} ESPN views for league ${leagueId}.`);
