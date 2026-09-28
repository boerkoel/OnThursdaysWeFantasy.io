import { mkdir, readFile, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

// Raw ESPN responses are working files for the other scripts; they're written
// compactly and not committed (see .gitignore). Live runs set ESPN_CORE_ONLY
// to fetch just the small league files they need.
const coreOnly = process.env.ESPN_CORE_ONLY === "true";
const views = coreOnly
  ? ["mSettings", "mTeam", "mMatchup"]
  : ["mSettings", "mTeam", "mRoster", "mMatchup", "mScoreboard", "mLiveScoring", "mDraftDetail"];

const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) {
  throw new Error("Missing ESPN_S2 or ESPN_SWID GitHub Actions secrets.");
}

async function fetchView(view, scoringPeriodId = null, fantasyFilter = null) {
  const url = new URL(base);
  url.searchParams.set("view", view);
  if (scoringPeriodId != null) url.searchParams.set("scoringPeriodId", String(scoringPeriodId));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "OnThursdaysWeFantasy/1.0",
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`,
      ...(fantasyFilter ? { "X-Fantasy-Filter": JSON.stringify(fantasyFilter) } : {})
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

function parseFantasyProsRosNotes(html) {
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  const rankings = [];
  const pattern = /(?:\||\b)(\d{1,3})\.\s+(.+?)\s+(QB|RB|WR|TE|K|DST)\s*-\s*([A-Z]{2,3})\b/g;

  for (const match of text.matchAll(pattern)) {
    const rank = Number(match[1]);
    const name = match[2].trim();
    const position = match[3];
    const team = match[4];

    if (!rank || !name || rankings.some(p => p.rank === rank)) continue;
    rankings.push({ rank, name, team, position });
  }

  return rankings.sort((a, b) => a.rank - b.rank);
}

async function fetchFantasyProsRosPpr() {
  const url = "https://www.fantasypros.com/nfl/notes/ros-overall.php?type=PPR";
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; OnThursdaysWeFantasy/1.0)"
      }
    });
    if (!response.ok) throw new Error(`FantasyPros request failed: ${response.status} ${response.statusText}`);

    const html = await response.text();
    const rankings = parseFantasyProsRosNotes(html);

    if (rankings.length < 200) {
      throw new Error(`FantasyPros parser found only ${rankings.length} rankings; refusing to replace the previous dataset.`);
    }

    await writeFile(
      "data/current/fantasypros-ros-ppr.json",
      JSON.stringify({
        source: "FantasyPros",
        rankingType: "Rest of Season",
        scoring: "PPR",
        fetchedAt: new Date().toISOString(),
        rankings
      }, null, 2) + "\n"
    );
    console.log(`Fetched ${rankings.length} FantasyPros ROS PPR rankings.`);
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
    JSON.stringify(results[view])
  );
}

if (coreOnly) {
  console.log(`Fetched core ESPN views for league ${leagueId}: ${views.join(", ")}.`);
  process.exit(0);
}

const currentScoringPeriod = Number(results.mMatchup?.scoringPeriodId || 1);
for (let week = 1; week <= currentScoringPeriod; week++) {
  console.log(`Fetching historical roster/boxscore data for week ${week}...`);
  const weeklyRoster = await fetchView("mRoster", week);
  const weeklyBoxscore = await fetchView("mBoxscore", week);
  await writeFile(
    `data/current/mRoster-week-${week}.json`,
    JSON.stringify(weeklyRoster)
  );
  await writeFile(
    `data/current/mBoxscore-week-${week}.json`,
    JSON.stringify(weeklyBoxscore)
  );
}

// Free agents and waiver players with each week's points, for the team
// profiles' waiver targets. The pool is today's free agents; weeks they were
// rostered are excluded later. Only the fields we use are kept.
async function fetchFreeAgentWeeks(lastWeek) {
  const FREE_AGENT_POOL = 400;
  const weeks = {};
  try {
    for (let week = 1; week <= lastWeek; week++) {
      const data = await fetchView("kona_player_info", week, {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          limit: FREE_AGENT_POOL,
          sortPercOwned: { sortPriority: 1, sortAsc: false }
        }
      });
      weeks[week] = (data.players || [])
        .map(entry => {
          const player = entry.player || {};
          const stat = (player.stats || []).find(s =>
            Number(s.scoringPeriodId) === week && Number(s.statSourceId) === 0 && Number(s.statSplitTypeId) === 1
          );
          return {
            playerId: Number(player.id ?? entry.id),
            name: player.fullName || `Player #${entry.id}`,
            defaultPositionId: Number(player.defaultPositionId || 0),
            eligibleSlots: (player.eligibleSlots || []).map(Number),
            points: Number(stat?.appliedTotal)
          };
        })
        .filter(p => Number.isFinite(p.points) && p.points > 0);
      console.log(`Week ${week}: ${weeks[week].length} free agents with points.`);
    }
    await writeFile(
      "data/current/free-agents.json",
      JSON.stringify({ fetchedAt: new Date().toISOString(), weeks }) + "\n"
    );
  } catch (error) {
    // Waiver targets are optional; keep the previous file if this fails.
    console.warn(`Free agent fetch skipped: ${error.message}`);
  }
}

await fetchFreeAgentWeeks(currentScoringPeriod);

await writeFile(
  "data/current/metadata.json",
  JSON.stringify({ season, leagueId, fetchedAt, views }, null, 2) + "\n"
);

await fetchFantasyProsRosPpr();

console.log(`Fetched ${views.length} ESPN views for league ${leagueId}.`);
