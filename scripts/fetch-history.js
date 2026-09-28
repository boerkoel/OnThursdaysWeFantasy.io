import { mkdir, readFile, writeFile } from "node:fs/promises";
import { managerKey } from "./lib/history.js";

// Saves each finished past season of the league (as listed by ESPN) to
// data/history/season-YYYY.json, once: teams, final ranks, playoff seeds and
// every game's score. Used by build-record-book.js. Managers are linked across
// seasons by a short hash of their ESPN account id, so no personal details
// are stored.
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;
if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

async function fetchSeason(season, view) {
  const url = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`);
  url.searchParams.set("view", view);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0", Cookie: `espn_s2=${espnS2}; SWID=${swid}` }
  });
  if (!response.ok) throw new Error(`${season} ${view}: ${response.status} ${response.statusText}`);
  return response.json();
}

const settings = JSON.parse(await readFile("data/current/mSettings.json", "utf8"));
const previousSeasons = settings.status?.previousSeasons || [];
await mkdir("data/history", { recursive: true });

for (const season of previousSeasons) {
  const path = `data/history/season-${season}.json`;
  const exists = await readFile(path).then(() => true).catch(() => false);
  if (exists) continue;
  try {
    const [seasonSettings, teamData, matchupData] = await Promise.all([
      fetchSeason(season, "mSettings"),
      fetchSeason(season, "mTeam"),
      fetchSeason(season, "mMatchup")
    ]);
    const scheduleSettings = seasonSettings.settings?.scheduleSettings || {};
    const regularSeasonWeeks = Number(scheduleSettings.matchupPeriodCount || 14);
    const history = {
      season,
      leagueName: seasonSettings.settings?.name || null,
      regularSeasonWeeks,
      playoffTeamCount: Number(scheduleSettings.playoffTeamCount || 6),
      teams: (teamData.teams || []).map(t => ({
        id: Number(t.id),
        manager: managerKey(t.primaryOwner || t.owners?.[0]),
        name: (t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`).trim(),
        finalRank: Number(t.rankCalculatedFinal || t.rankFinal || 0) || null,
        playoffSeed: Number(t.playoffSeed || 0) || null
      })),
      games: (matchupData.schedule || [])
        .filter(m => m.home?.teamId && m.away?.teamId)
        .map(m => ({
          week: Number(m.matchupPeriodId),
          home: Number(m.home.teamId),
          away: Number(m.away.teamId),
          homeScore: Number(m.home.totalPoints || 0),
          awayScore: Number(m.away.totalPoints || 0),
          winner: m.winner,
          playoff: Number(m.matchupPeriodId) > regularSeasonWeeks,
          tier: m.playoffTierType || null
        }))
    };
    await writeFile(path, JSON.stringify(history) + "\n");
    console.log(`Saved ${season}: ${history.teams.length} teams, ${history.games.length} games.`);
  } catch (error) {
    // Try again on the next daily run.
    console.warn(`Could not save ${season}: ${error.message}`);
  }
}
